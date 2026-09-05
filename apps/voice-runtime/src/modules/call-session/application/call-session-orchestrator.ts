import { randomUUID } from "node:crypto";
import { Inject, Injectable, Scope } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  CALL_TRANSFER_PROVIDER,
  type CallTransferProvider,
} from "../../telephony/domain/call-transfer.port";
import {
  ORCHESTRATOR_CLIENT,
  OrchestratorCapacityExceededError,
  OrchestratorConflictError,
  OrchestratorHttpError,
  type OrchestratorClientPort,
  type TurnResult,
} from "../../orchestrator-client/domain/orchestrator-client.port";
import {
  SPEECH_TO_TEXT_PROVIDER,
  type SpeechToTextProvider,
  type SpeechToTextSession,
} from "../../speech/domain/speech-to-text.port";
import {
  TEXT_TO_SPEECH_PROVIDER,
  type TextToSpeechProvider,
} from "../../speech/domain/text-to-speech.port";
import { ALLOWED_TOOLS, type CallSessionParams } from "../domain/call-session";
import type { MediaStreamSink } from "../domain/media-stream-sink.port";
import {
  TWILIO_MEDIA_ENCODING,
  TWILIO_MEDIA_SAMPLE_RATE_HZ,
} from "../../telephony/domain/twilio-media-stream.types";

/** Bounds a capacity-429 wait loop — a caller genuinely on hold this long has almost certainly already hung up or should hit the tenant's configured overflowNumber instead of waiting forever. Not a documented constant, an INFERRED safety limit (same honesty convention as voice-orchestrator's own MAX_TOOL_ITERATIONS). */
const MAX_CAPACITY_RETRY_ATTEMPTS = 3;
/** Bounds a turn's ambiguous-outcome retry loop (docs/28 §G: retry the SAME idempotencyKey on timeout/5xx). Not calling shared-kernel's withRetry directly: its exponential-backoff timing (up to 64s between attempts) is wrong for a caller on a live line waiting to hear a response — a live call needs a much tighter, capped retry, not the platform-wide async-job default. */
const MAX_TURN_RETRY_ATTEMPTS = 3;
const TURN_RETRY_DELAY_MS = 500;
/**
 * How long to wait for onInterimSpeech to confirm a SpeechStarted event
 * before treating it as noise (a breath, a cough, background audio) and
 * never firing the barge-in it would otherwise have triggered. Deepgram's
 * own interim results typically follow real speech onset within a few
 * hundred ms; this is a generous upper bound, not a tuned latency target
 * — safe to be generous because a genuine interruption that somehow
 * skips confirmation entirely is still caught by
 * handleFinalTranscript's own defensive abort-the-previous-turn guard
 * once its finalized transcript arrives, so this timer is never the ONLY
 * thing standing between a real interruption and a stuck response.
 */
const BARGE_IN_CONFIRMATION_TIMEOUT_MS = 500;

/**
 * How long Grace waits with no REAL recognized caller speech — not
 * "zero VAD activity," see below — after she finishes speaking before
 * proactively checking in. Found live on a real ~21-minute call: several
 * gaps of 33-89 seconds with no check-in at all, because no such
 * mechanism existed anywhere in this codebase (an audit confirmed this
 * directly — there was no prior "one-time vs repeating" behavior to
 * preserve, contrary to an earlier assumption).
 *
 * What resets this timer changed after a REAL call exposed a flaw in the
 * first version: that version reset it on ANY detected audio, including
 * a bare VAD SpeechStarted blip with no recognized content, on the
 * reasoning that any detected audio proves presence. A real ~2.5-minute
 * call proved that too permissive in practice — Deepgram fired
 * SpeechStarted/empty-Results events every 1-3 seconds for a continuous
 * 37-second stretch (transcriptLength: 0 on nearly all of them, almost
 * certainly background noise), so the timer never got a clean window to
 * fire in an environment with any ambient noise at all — the caller
 * eventually had to say "hey grace i'm waiting for a reply" because it
 * never checked in. Only `handleInterimSpeech` (Deepgram delivering REAL
 * recognized text, not just VAD energy) resets it now; a bare
 * content-free blip doesn't extend the window, but doesn't need to —
 * nothing disarms it either, so the check-in still fires at its
 * originally-scheduled time regardless of how much background noise
 * happened in the meantime.
 *
 * Distinct in PURPOSE from `SPEECH_FINAL_FALLBACK_MS`
 * (deepgram-stt.provider.ts): that one fires when the caller genuinely
 * IS making sound but it never cleanly finalizes into a transcript (the
 * "lots of noise, never resolves" case, already found and fixed
 * separately); this one fires when the caller never said anything
 * recognizable at all. They don't compete — different trigger, different
 * purpose, both real gaps found on real calls.
 *
 * INFERRED, not a measured constant — a real "let me think" pause is
 * typically well under this; by the time this long has passed with
 * nothing recognizable said, it reads as dead air, not thinking time.
 *
 * Read from `process.env` at call time (raw, not the validated `Env`
 * object — same convention `executeEmergencyTransfer` already uses in
 * this same file) rather than a plain constant, specifically so tests
 * can override it to a tiny value: a real 10s timer left armed by a test
 * that doesn't call `onCallEnd` (most of the 26 pre-existing tests in
 * this file don't, since they're testing something else entirely) kept
 * the whole process alive for the full 10s after the test run finished
 * — found live running this file's own suite, not a hypothetical.
 */
const DEFAULT_SILENCE_CHECK_IN_TIMEOUT_MS = 10_000;
function silenceCheckInTimeoutMs(): number {
  const raw = process.env["SILENCE_CHECK_IN_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SILENCE_CHECK_IN_TIMEOUT_MS;
}

/**
 * Deliberately warm, not alarmed — this fires after genuine silence, not
 * necessarily a problem, so it shouldn't sound like one. Spoken AT MOST
 * ONCE per silence episode (see `speakSilenceCheckIn`'s own comment) —
 * never a repeating nag, by construction: its own `speak()` call does
 * NOT re-arm the timer, unlike every other caller of `speak()` in this
 * class.
 */
const SILENCE_CHECK_IN_PHRASE = "Take your time — I'm still here.";

/**
 * The one class that actually drives a phone call end to end — receives
 * Twilio Media Stream lifecycle events + STT results from the WebSocket
 * gateway (interfaces layer, which owns nothing but wiring this class to a
 * real `ws` connection) and turns them into the exact sequence docs/28
 * §J/§K/§L/§M specify. Everything below maps directly to a numbered
 * section of that contract — see each method's own comment for the
 * specific citation.
 *
 * `scope: Scope.TRANSIENT` — FOUND LIVE, the single most severe bug this
 * whole investigation turned up: this class's own instance fields
 * (conversationId, ended, activeTurnAbort, ...) are only safe because
 * every live call is supposed to get its OWN instance, and
 * media-stream.gateway.ts calls `moduleRef.resolve(CallSessionOrchestrator,
 * ...)` (not `.get()`) specifically to get one. But `@Injectable()` alone
 * defaults to Nest's DEFAULT (singleton) scope — and for a
 * DEFAULT-scoped provider, `moduleRef.resolve()` does NOT create a new
 * instance; it returns the SAME shared singleton every time, identically
 * to `.get()`. A previous version of this file's own module-level
 * comment even asserted the opposite ("moduleRef.resolve() ... creates a
 * fresh instance … per call") — true for TRANSIENT/REQUEST scope, false
 * for DEFAULT, and this provider was never actually marked either of the
 * former. The real consequence, reproduced from a live call's own logs:
 * call N's caller hangs up, onCallEnd sets `this.ended = true` on the
 * (shared) instance; call N+1 arrives on the SAME still-running process,
 * `onCallStart` runs successfully on that SAME reused instance (greeting
 * plays, STT opens, transcripts get recognized correctly) — but
 * `this.ended` is still `true` from call N, so handleFinalTranscript's
 * own guard silently no-ops on EVERY turn, for the rest of that call,
 * with zero logs on either the success or failure path (indistinguishable
 * from total unresponsiveness). Every call after the FIRST one on a
 * given running process was broken this way, until the process happened
 * to restart — exactly the "greets fine, then never responds again,
 * every time I call back" pattern reported live, repeatedly. TRANSIENT
 * (not REQUEST — there is no HTTP request context here, this is a
 * WebSocket connection's own lifecycle) makes `resolve()`'s per-call
 * instantiation the module's own long-standing intent finally correct
 * in practice, not just in a comment.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class CallSessionOrchestrator {
  private conversationId: string | null = null;
  private sttSession: SpeechToTextSession | null = null;
  private activeTurnAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsPlaying = false;
  private ended = false;
  /**
   * Set by `handleBargeIn` and checked by `handleFinalTranscript`'s
   * queued chunk-speaking closures — see the streaming redesign's own
   * comment on `handleFinalTranscript` for why this exists: once a turn
   * streams its response progressively (speaking chunk 1 while chunk 2
   * is still arriving over the still-open HTTP connection), a barge-in
   * has to cancel not just the CURRENTLY-playing chunk (already handled
   * by `ttsAbort`) but every chunk still queued behind it — otherwise a
   * chunk that arrives (or was already buffered) after the barge-in
   * would start NEW audio playing over the caller. Reset to `false` at
   * the top of every `handleFinalTranscript` call, so it never leaks
   * across turns.
   */
  private bargedInDuringCurrentTurn = false;
  /**
   * FOUND LIVE: acting on Deepgram's raw SpeechStarted (VAD onset) alone
   * killed an in-flight response on every single speech-detection blip,
   * confirmed real speech or not — a real call's own transcript showed
   * only 2 of 12 turns ever completing, the rest aborted within 0.3-1.6s
   * of starting, most before Grace had said more than a word or two.
   * Non-null while waiting for onInterimSpeech to CONFIRM real words are
   * being recognized, not just VAD energy — see handleSpeechStarted's
   * own comment for the full reasoning, including why this is safe even
   * when confirmation never arrives.
   */
  private pendingBargeInTimer: ReturnType<typeof setTimeout> | null = null;
  /** See `DEFAULT_SILENCE_CHECK_IN_TIMEOUT_MS`'s own comment for the full design. */
  private silenceCheckInTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @Inject(ORCHESTRATOR_CLIENT) private readonly orchestrator: OrchestratorClientPort,
    @Inject(SPEECH_TO_TEXT_PROVIDER) private readonly stt: SpeechToTextProvider,
    @Inject(TEXT_TO_SPEECH_PROVIDER) private readonly tts: TextToSpeechProvider,
    @Inject(CALL_TRANSFER_PROVIDER) private readonly callTransfer: CallTransferProvider,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  /**
   * docs/28 §J — call-start sequence. Synchronous and must succeed before
   * anything else per §J step 2; a failure here is this runtime's own
   * production decision to make (docs/28: "fallback routing, an apology
   * message via a static TTS clip, etc."). This implementation speaks a
   * static apology via TTS and ends the media stream — it does not attempt
   * fallback routing to a human number, since no such number is configured
   * anywhere in this runtime's scope (TenantRoutingProvider only resolves
   * tenantId/businessId, not a fallback destination — a real deployment
   * wanting that should extend TenantRoute, not this class).
   *
   * CAPACITY-429 HANDLING: docs/36 §3 admits capacity at exactly this call
   * (`StartConversationUseCase`'s FIRST gate) — so a call-start 429 is the
   * PRIMARY case docs/36 §4's "the Voice Runtime is expected to play its
   * own short waiting/brochure experience... and retry per Retry-After" is
   * actually describing, not an edge case. Found live, not hypothetical:
   * this used to fall into the generic catch-all below and immediately
   * apologize-and-hang-up on ANY capacity rejection, even though the exact
   * retry-with-brochure loop this needs already existed one level down, in
   * handleFinalTranscript's own turn-retry handling (see its own comment) —
   * just never applied to the one place capacity is actually gated. Mirrors
   * that same loop exactly, not a new pattern.
   */
  async onCallStart(params: CallSessionParams, sink: MediaStreamSink): Promise<void> {
    const log = this.logger.child({ tenantId: params.tenantId, callId: params.callId });

    let conversationId: string;
    let greeting: string | undefined;
    let capacityAttempts = 0;
    for (;;) {
      try {
        const conversation = await this.orchestrator.startConversation({
          tenantId: params.tenantId,
          businessId: params.businessId,
          callId: params.callId,
          callerAni: params.callerAni,
          toNumber: params.toNumber,
          timezone: params.timezone,
        });
        conversationId = conversation.id;
        greeting = conversation.greeting;
        log.info("conversation started", { conversationId: conversation.id });
        break;
      } catch (error) {
        if (error instanceof OrchestratorCapacityExceededError) {
          capacityAttempts += 1;
          if (capacityAttempts > MAX_CAPACITY_RETRY_ATTEMPTS) {
            log.warn("capacity retry budget exhausted at call start — ending call", {
              attempts: capacityAttempts,
            });
            await this.speakApologyAndClose(sink);
            return;
          }
          const segment = error.waitingExperience.brochureSegment;
          if (segment) {
            await this.speak(segment.text, sink);
          }
          await sleep(error.retryAfterSeconds * 1000);
          continue;
        }
        if (error instanceof OrchestratorConflictError) {
          // docs/28 §B.1's 409 case: a retried start for a callId that
          // actually succeeded the first time. Per §I's documented gap,
          // there is no lookup-by-callId route — this runtime's process
          // model (one CallSessionOrchestrator instance per live WebSocket
          // connection, never restarted mid-call, see class-level comment)
          // means this path is unreachable in normal operation, not
          // silently swallowed: if it IS reached, the call cannot be
          // recovered, so it fails the same way any other start failure
          // does below.
          log.warn("conversation start returned 409 — cannot recover conversationId (docs/28 §I)", {
            error: error.message,
          });
        } else {
          log.error("conversation start failed — playing apology and ending call", {
            reason: error instanceof Error ? error.message : String(error),
          });
        }
        await this.speakApologyAndClose(sink);
        return;
      }
    }
    this.conversationId = conversationId;

    try {
      this.sttSession = await this.stt.openSession({
        sampleRateHz: TWILIO_MEDIA_SAMPLE_RATE_HZ,
        encoding: TWILIO_MEDIA_ENCODING,
      });
    } catch (error) {
      log.error("STT session failed to open — ending call", {
        reason: error instanceof Error ? error.message : String(error),
      });
      await this.speakApologyAndClose(sink);
      return;
    }

    this.sttSession.onFinalTranscript((result) => {
      this.handleFinalTranscript(params, sink, result).catch((error: unknown) => {
        log.error("unhandled error processing finalized transcript", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    });
    this.sttSession.onSpeechStarted(() => this.handleSpeechStarted());
    this.sttSession.onInterimSpeech(() => this.handleInterimSpeech(params, sink));
    this.sttSession.onError((error) => {
      // Found live, not hypothetical: this used to only log. `ws`'s
      // WebSocket never reconnects on its own and DeepgramSttSession has
      // no reconnect logic of its own either, so once this fires, STT is
      // permanently dead for the rest of the call: every later
      // sendAudio() call still succeeds silently (the socket just isn't
      // OPEN, so frames are buffered forever, see sendAudio's own
      // buffering comment), meaning the caller could talk for the
      // remainder of the call and never be transcribed, with nothing
      // user-facing ever telling them or ending the call. Ending the call
      // the same way openSession() itself failing already does (apology,
      // then close) is the correct, honest outcome, not a worse
      // regression risk than the silent-forever alternative it replaces.
      log.error("STT session error, ending call, session cannot recover", {
        reason: error.message,
      });
      if (this.ended) {
        return;
      }
      this.speakApologyAndClose(sink).catch((closeError: unknown) => {
        log.error("failed to speak apology after STT session error", {
          reason: closeError instanceof Error ? closeError.message : String(closeError),
        });
      });
    });

    // The most serious bug found this whole build, live: every call
    // connected successfully — Twilio routed, TwiML answered, the Media
    // Stream opened, the conversation started — and then NOTHING ever
    // spoke, because nothing in this class, or anywhere in docs/28 §J's
    // documented call-start sequence, ever produced an opening line. Both
    // sides waited in silence for the other to speak first, forever; a
    // caller hearing dead air on connect reasonably assumes the call
    // itself failed. Spoken AFTER the STT handlers above are already
    // registered (not before) so barge-in works correctly if the caller
    // starts talking before the greeting finishes — the same
    // ttsPlaying/onSpeechStarted mechanism `speak()` already uses for
    // every later turn, not a special case for this one.
    if (greeting) {
      await this.speak(greeting, sink);
      this.armSilenceCheckIn(sink);
    } else {
      // Only reachable against an older voice-orchestrator deployment
      // that predates this fix (rolling deploy, or a stale build) — a
      // missing greeting is a real regression back to the silent-call bug
      // above, not a scenario to crash the call over.
      log.warn("startConversation returned no greeting — call will open silently");
    }
  }

  /** Forwards one inbound Twilio Media Stream audio frame into the live STT session. No-op if the session never opened (start already failed and the call is being torn down). */
  onAudioFrame(frame: Buffer): void {
    this.sttSession?.sendAudio(frame);
  }

  /**
   * docs/28 §K — finalized-turn sequence. `idempotencyKey` is generated
   * ONCE per attempt and reused verbatim across this method's own retry
   * loop (docs/28 §G: "never generate a fresh key for what might be the
   * same attempt") — the retry loop below is exactly the mechanism that
   * rule exists to make safe.
   *
   * STREAMING (the voice-latency optimization's headline fix): each
   * `onChunk` callback below queues that chunk's text onto `speakQueue`
   * rather than waiting for `handleTurn` to fully resolve — the caller
   * starts hearing the model's opening acknowledgment while a tool call
   * or a second LLM completion is still resolving in the background,
   * the same pause a human takes mid-sentence, instead of dead air for
   * the whole turn. `speakQueue` (not a bare series of awaited `speak()`
   * calls) exists because chunks must never be spoken out of order or
   * overlapping, while `onChunk` itself must return near-instantly so
   * it never blocks draining the underlying HTTP stream (see
   * HttpOrchestratorClient's own comment) — chaining onto a promise
   * gives both for free. By the time `turnResult` resolves, its
   * `responseText` has ALREADY been spoken via these chunks (a cached/
   * replayed turn streams its whole responseText as a single chunk too
   * — see voice-orchestrator's `/turns` controller — so this is uniform
   * across both cases), so it must NEVER be spoken again afterward —
   * that would repeat the entire response a second time.
   *
   * RETRY SAFETY: docs/28 §G's retry-the-same-idempotencyKey rule was
   * written for a contract where NOTHING is spoken until the whole turn
   * resolves — retrying an ambiguous outcome was always safe because
   * the caller had heard nothing yet either way. That assumption breaks
   * under streaming: if a mid-stream failure happens AFTER the caller
   * already heard one or more chunks, a retry re-invokes the LLM from
   * scratch (a failed attempt releases its idempotency reservation
   * rather than completing it — see HandleTurnUseCase's admitTurn) and
   * could produce DIFFERENT text than what was already spoken —
   * duplicate or contradictory speech, exactly what barge-in handling
   * elsewhere in this class exists to prevent. `chunksReceivedThisAttempt`
   * exists specifically to detect that case and refuse to retry it; a
   * failure before any chunk arrived is unaffected and keeps the
   * original retry behavior exactly as before streaming existed.
   */
  private async handleFinalTranscript(
    params: CallSessionParams,
    sink: MediaStreamSink,
    result: { transcript: string; confidence: number },
  ): Promise<void> {
    if (!this.conversationId || this.ended) {
      return;
    }
    // A real turn is starting — disarm (not re-arm) the silence check-in
    // for the duration of turn processing. handleInterimSpeech RESETS it
    // (arms a fresh window) once the caller's speech has real recognized
    // content; this is the one place it needs to stop ticking entirely,
    // since system latency (the HTTP round-trip, tool calls) is not
    // caller silence — it re-arms again, correctly, once Grace's
    // response has actually been spoken (below).
    this.disarmSilenceCheckIn();
    // Defense-in-depth, not a behavior change in the working case: today
    // this is always already null here, because Deepgram's SpeechStarted
    // (which drives handleBargeIn) fires before the speech_final event
    // that reaches this method for the SAME utterance, so the previous
    // turn is always already aborted by the time a new one starts. But
    // nothing here actually ENFORCED that — this method just overwrote
    // `activeTurnAbort` unconditionally, so any future change to the
    // barge-in trigger path (or an unexpected STT provider event
    // ordering) could silently let two turns run concurrently, each
    // eventually calling speak() — the exact overlapping/contradictory
    // speech class of bug this codebase has otherwise been careful to
    // rule out by construction. Aborting here too, at the one place that
    // actually starts a new turn, makes that invariant hold regardless of
    // whether the barge-in path did its job first.
    if (this.activeTurnAbort) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = null;
    }
    const log = this.logger.child({ tenantId: params.tenantId, callId: params.callId });
    const idempotencyKey = randomUUID();
    const conversationId = this.conversationId;
    // Temporary, targeted timing/content visibility — actively diagnosing
    // a real live report of 30-40s+ perceived response latency and a
    // caller-given name only partially captured. Neither this turn's
    // actual /turns round-trip duration nor its transcript text had any
    // visibility anywhere before this; DeepgramSttSession's own finalized-
    // transcript log (this same diagnostic pass) is the other half.
    const turnStartedAt = Date.now();
    log.info("finalized transcript received, starting turn", {
      transcript: result.transcript,
      confidence: result.confidence,
    });

    let turnResult: TurnResult | null = null;
    let capacityAttempts = 0;
    let turnAttempts = 0;
    this.bargedInDuringCurrentTurn = false;
    let speakQueue: Promise<void> = Promise.resolve();

    while (turnResult === null) {
      const abortController = new AbortController();
      this.activeTurnAbort = abortController;
      let chunksReceivedThisAttempt = false;

      try {
        turnResult = await this.orchestrator.handleTurn(
          conversationId,
          {
            tenantId: params.tenantId,
            idempotencyKey,
            transcript: result.transcript,
            sttConfidence: result.confidence,
            allowedTools: [...ALLOWED_TOOLS],
          },
          abortController.signal,
          (text) => {
            chunksReceivedThisAttempt = true;
            speakQueue = speakQueue.then(() => {
              if (this.bargedInDuringCurrentTurn) {
                return;
              }
              return this.speak(text, sink);
            });
          },
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          // Barge-in fired mid-turn (docs/28 §B.3 mechanism 1) — the caller
          // is already speaking their next utterance, which will itself
          // produce a new finalized transcript and a new turn. Silently
          // drop this one rather than retrying or speaking anything
          // further (handleBargeIn already stopped whatever was
          // currently playing and marked the rest of speakQueue as
          // cancelled).
          this.activeTurnAbort = null;
          await speakQueue;
          return;
        }

        if (chunksReceivedThisAttempt) {
          log.warn(
            "turn failed mid-stream after the caller had already heard part of the response — not retrying (a retry could produce different, contradictory speech); ending this turn",
            { conversationId, reason: error instanceof Error ? error.message : String(error) },
          );
          this.activeTurnAbort = null;
          await speakQueue;
          return;
        }

        if (error instanceof OrchestratorCapacityExceededError) {
          capacityAttempts += 1;
          if (capacityAttempts > MAX_CAPACITY_RETRY_ATTEMPTS) {
            log.warn("capacity retry budget exhausted — ending call", { conversationId });
            await this.speakApologyAndClose(sink);
            this.activeTurnAbort = null;
            return;
          }
          const segment = error.waitingExperience.brochureSegment;
          if (segment) {
            await this.speak(segment.text, sink);
          }
          await sleep(error.retryAfterSeconds * 1000);
          this.activeTurnAbort = null;
          continue;
        }

        const retryable =
          error instanceof OrchestratorHttpError
            ? error.retryable
            : !(error instanceof OrchestratorConflictError);
        turnAttempts += 1;
        if (!retryable || turnAttempts >= MAX_TURN_RETRY_ATTEMPTS) {
          log.error("turn failed after retry budget exhausted", {
            conversationId,
            reason: error instanceof Error ? error.message : String(error),
            attempts: turnAttempts,
          });
          await this.speak(
            "Sorry, I'm having trouble right now. Let me have someone call you back.",
            sink,
          );
          this.activeTurnAbort = null;
          return;
        }
        log.warn("turn failed, retrying with the SAME idempotencyKey (docs/28 §G)", {
          conversationId,
          idempotencyKey,
          attempt: turnAttempts,
        });
        await sleep(TURN_RETRY_DELAY_MS);
        this.activeTurnAbort = null;
      }
    }

    this.activeTurnAbort = null;
    log.info("turn HTTP round-trip completed", {
      durationMs: Date.now() - turnStartedAt,
      toolCallsExecuted: turnResult.toolCallsExecuted,
      responseText: turnResult.responseText,
    });

    // responseText was already spoken (or queued to speak) chunk by
    // chunk as it streamed in above — this just waits for every queued
    // chunk to actually finish playing before deciding whether to
    // transfer, never re-speaking the same text a second time.
    await speakQueue;

    if (turnResult.escalation?.action === "forward_call") {
      log.info("emergency escalation signaled — executing call transfer (docs/28 §M)", {
        conversationId,
        severity: turnResult.escalation.severity,
        resolvedOnCallDestination: turnResult.escalation.transferDestination,
      });
      // The response text has already been spoken above (awaited via
      // speakQueue) — the caller hears SOMETHING before the line hands
      // off, rather than silence during the transfer's own connection
      // setup latency, without speaking it twice. Best-effort: if the
      // transfer itself fails, the call continues normally rather than
      // dropping silently.
      await this.executeEmergencyTransfer(params, log, turnResult.escalation.transferDestination);
    } else {
      // Grace just finished speaking her real response and isn't being
      // handed off — this IS the "now waiting on the caller" checkpoint.
      // Deliberately NOT armed in the transfer branch above: mid-transfer
      // isn't a moment to proactively check in on.
      this.armSilenceCheckIn(sink);
    }
  }

  /**
   * FOUND LIVE: the previous design called handleBargeIn directly from
   * this event — Deepgram's raw VAD onset, fired the instant audio
   * energy crosses a threshold, with zero guarantee real speech follows.
   * A real call's own transcript showed the cost precisely: only 2 of 12
   * turns ever completed, the rest aborted within 0.3-1.6s of starting,
   * most before Grace had said more than a word or two — every breath,
   * cough, or moment of background noise was killing an in-flight
   * response exactly as effectively as a genuine interruption.
   *
   * Now: starts (or restarts, on a burst of SpeechStarted events —
   * clearing and resetting the same timer coalesces that burst into one
   * confirmation window rather than firing once per blip) a bounded wait
   * for onInterimSpeech to confirm real words are actually being
   * recognized. If confirmation never arrives within the timeout, this
   * SpeechStarted event is treated as noise and the in-flight response
   * (if any) is never touched.
   *
   * Why this is safe even when a genuine interruption is somehow missed
   * (Deepgram delivers speech_final without a preceding interim, or the
   * caller's utterance is so short the timer hasn't fired yet):
   * handleFinalTranscript's own defensive guard aborts any still-active
   * previous turn itself, at the moment the NEW finalized transcript
   * starts a turn — this was added specifically as defense-in-depth
   * against exactly this kind of gap, independent of whatever the
   * barge-in path did or didn't do. This timer is a responsiveness
   * optimization (interrupt AS SOON AS real speech is confirmed,
   * without waiting for full finalization), not the only thing
   * preventing a stale response from lingering.
   */
  private handleSpeechStarted(): void {
    // Found live on a real call: this used to reset the silence check-in
    // here too, on the reasoning that ANY detected audio proves presence.
    // A real ~2.5-minute call proved that wrong in practice — a raw VAD
    // onset fires on background noise as readily as real speech (this
    // exact call had a SpeechStarted/empty-Results event every 1-3
    // seconds, transcriptLength: 0, for a continuous 37-second stretch,
    // per Deepgram's own event log), so resetting on it meant the check-in
    // essentially never got a clean window to fire at all — the caller
    // eventually had to say "hey grace i'm waiting for a reply" because it
    // never checked in. `handleInterimSpeech` (real recognized text, not
    // just VAD energy) is the correct, much rarer signal for "the caller
    // is genuinely making sound" — kept there, removed here. A bare blip
    // with no content doesn't extend the window, but it doesn't need to:
    // nothing here disarms it either, so the check-in still fires at its
    // originally-scheduled time regardless — no permanent-silencing risk.
    if (this.pendingBargeInTimer) {
      clearTimeout(this.pendingBargeInTimer);
    }
    this.pendingBargeInTimer = setTimeout(() => {
      this.pendingBargeInTimer = null;
    }, BARGE_IN_CONFIRMATION_TIMEOUT_MS);
  }

  /** Confirms a pending SpeechStarted as real speech, per handleSpeechStarted's own comment — fires the actual barge-in now instead of waiting out the rest of the confirmation window. A no-op if nothing is currently pending (no SpeechStarted preceded this, or it already timed out). */
  private handleInterimSpeech(params: CallSessionParams, sink: MediaStreamSink): void {
    this.armSilenceCheckIn(sink);
    if (!this.pendingBargeInTimer) {
      return;
    }
    clearTimeout(this.pendingBargeInTimer);
    this.pendingBargeInTimer = null;
    this.handleBargeIn(params, sink);
  }

  /**
   * Arms a bounded wait for the caller to make ANY sound after Grace has
   * just finished speaking (see `DEFAULT_SILENCE_CHECK_IN_TIMEOUT_MS`'s own
   * comment). Called explicitly at each real "Grace just stopped
   * talking, now waiting on the caller" checkpoint — never baked into
   * `speak()` itself, so capacity-wait/apology utterances (which aren't
   * genuinely "waiting for the caller's next turn") don't arm it, and
   * `speakSilenceCheckIn`'s own check-in utterance doesn't re-arm it
   * either, by simply never calling this method.
   */
  private armSilenceCheckIn(sink: MediaStreamSink): void {
    this.disarmSilenceCheckIn();
    this.silenceCheckInTimer = setTimeout(() => {
      this.silenceCheckInTimer = null;
      this.speakSilenceCheckIn(sink);
    }, silenceCheckInTimeoutMs());
  }

  /** Cancels any pending silence check-in without speaking one — real caller activity, a new turn starting, or the call ending all mean there's nothing to check in about. */
  private disarmSilenceCheckIn(): void {
    if (this.silenceCheckInTimer) {
      clearTimeout(this.silenceCheckInTimer);
      this.silenceCheckInTimer = null;
    }
  }

  /**
   * Fires AT MOST ONCE per silence episode — deliberately does not call
   * `armSilenceCheckIn` again afterward, unlike a normal turn response,
   * so a caller who stays silent even after this never hears it a
   * second time; the call simply keeps waiting (the caller speaking,
   * hanging up, or the call reaching its own natural end are all still
   * live outcomes, just not another reminder). Re-arms normally the next
   * time Grace speaks for a REAL reason. Defensively no-ops if the call
   * already ended, TTS is already playing, or a turn is actually in
   * flight — belt-and-suspenders against a race this class's own
   * disarm-on-activity wiring should already prevent.
   */
  private speakSilenceCheckIn(sink: MediaStreamSink): void {
    if (this.ended || this.ttsPlaying || this.activeTurnAbort) {
      return;
    }
    this.logger.info(
      "silence check-in: no caller activity detected for the full timeout — speaking a one-time check-in",
      { conversationId: this.conversationId, timeoutMs: silenceCheckInTimeoutMs() },
    );
    this.speak(SILENCE_CHECK_IN_PHRASE, sink).catch((error: unknown) => {
      this.logger.warn("silence check-in TTS failed", {
        conversationId: this.conversationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * docs/28 §B.3 — barge-in. Two mechanisms, MUTUALLY EXCLUSIVE, chosen
   * based on what's actually happening right now: if a turn's HTTP call
   * is still in flight, abort it directly (mechanism 1); only when it's
   * NOT (i.e. the turn already fully finished and TTS is now just
   * playing its already-known-complete response) does the
   * lighter-weight /interrupt endpoint (mechanism 2) apply. Either way,
   * Twilio's own audio buffer is cleared so queued-but-unplayed audio
   * stops immediately — the HTTP-level abort/interrupt alone does not
   * silence audio Twilio already received.
   *
   * Before streaming, these two conditions were NEVER simultaneously
   * true by construction: `activeTurnAbort` was always cleared before
   * `speak()` (and thus `ttsPlaying`) ever started, so checking both
   * unconditionally never actually observed both at once. Streaming
   * broke that: TTS can now be playing chunk 1 WHILE the HTTP
   * connection is still open waiting for chunk 2, meaning both are
   * genuinely true together. Firing mechanism 2 in that window would be
   * wrong — voice-orchestrator hasn't durably saved this turn's
   * messages yet (`saveTurnResult` only runs once, after the WHOLE
   * tool-call loop finishes, see HandleTurnUseCase's own comment), so
   * `/interrupt`'s "the full response was already durably saved before
   * playback started" assumption (see InterruptConversationUseCase) is
   * false mid-stream. The explicit `return` below after mechanism 1
   * keeps the two paths exclusive instead of relying on timing.
   */
  private handleBargeIn(params: CallSessionParams, sink: MediaStreamSink): void {
    this.bargedInDuringCurrentTurn = true;

    if (this.activeTurnAbort) {
      // A real observability gap found while chasing a live silent-call
      // report: neither mechanism here logged anything on its own, so a
      // real barge-in was previously indistinguishable, from logs alone,
      // from something else silently killing an in-flight turn.
      this.logger.info("barge-in: aborting in-flight turn (mechanism 1)", {
        conversationId: this.conversationId,
      });
      this.activeTurnAbort.abort();
      this.activeTurnAbort = null;
      if (this.ttsAbort) {
        this.ttsAbort.abort();
        this.ttsAbort = null;
      }
      if (this.ttsPlaying) {
        sink.clearQueuedAudio();
        this.ttsPlaying = false;
      }
      return;
    }

    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }
    if (this.ttsPlaying) {
      this.logger.info(
        "barge-in: TTS was playing between turns, calling /interrupt (mechanism 2)",
        {
          conversationId: this.conversationId,
        },
      );
      sink.clearQueuedAudio();
      this.ttsPlaying = false;
      if (this.conversationId) {
        this.orchestrator
          .interrupt(this.conversationId, { tenantId: params.tenantId })
          .catch((error: unknown) => {
            this.logger.warn("interrupt call failed (non-fatal, best-effort)", {
              conversationId: this.conversationId,
              reason: error instanceof Error ? error.message : String(error),
            });
          });
      }
    }
  }

  /**
   * docs/28 §L — call-end sequence. Best-effort: a core-api/orchestrator
   * outage at hangup time must never block this runtime's own cleanup
   * (§L step 3).
   *
   * Idempotency guard, deliberately the very first statement — a real,
   * previously-shipped bug found live: MediaStreamGateway can (and, per its
   * own comment, EXPECTS to) call this twice for the same call — Twilio's
   * documented `stop` event and the socket's `close` event both trigger it,
   * and a raw network drop can fire `close` without a `stop` ever arriving
   * first. The gateway's own comment claims "onCallEnd's `this.ended` guard
   * ... makes that safe," but no such guard actually existed here — `ended`
   * was only ever read by the turn-handling path (`onAudioFrame`/its own
   * turn loop), never checked by this method itself, so both callers ran
   * the full body, including a SECOND real HTTP call to
   * `orchestrator.endConversation()` for the same conversation. That
   * duplicate call is a real trigger for the exact race
   * EndConversationUseCase/RedisConversationRepository (voice-orchestrator,
   * now CAS-protected via `Conversation.version` — see that repository's
   * own comment) and EndCallUseCase (core-api, CAS-protected via
   * `fromStatus`/`toStatus`) were each independently made safe against —
   * this guard fixes it at the source instead of relying ONLY on those
   * downstream backstops, which still matter as defense-in-depth against
   * every OTHER path that can produce two concurrent end-of-call signals
   * for the same conversation (a Voice Runtime process crash-and-retry, a
   * duplicate Twilio status callback, ...), not just this specific one.
   */
  async onCallEnd(params: CallSessionParams, endReason: string): Promise<void> {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.activeTurnAbort?.abort();
    this.ttsAbort?.abort();
    if (this.pendingBargeInTimer) {
      clearTimeout(this.pendingBargeInTimer);
      this.pendingBargeInTimer = null;
    }
    this.disarmSilenceCheckIn();
    await this.sttSession?.close().catch(() => undefined);

    if (!this.conversationId) {
      return;
    }
    try {
      await this.orchestrator.endConversation(this.conversationId, {
        tenantId: params.tenantId,
        endReason,
      });
      // Another real observability gap found while reconstructing a live
      // call's full timeline: this method previously logged NOTHING on its
      // success path — only the best-effort-failure branch below ever
      // wrote a line — so a call that ended cleanly and a call whose
      // runtime silently got stuck mid-conversation were indistinguishable
      // from logs alone; the only signal either way was the log simply
      // stopping. This closes that gap the same way SpeechStarted/
      // handleBargeIn's own gaps were closed earlier in this
      // investigation.
      this.logger.info("call ended", { conversationId: this.conversationId, endReason });
    } catch (error) {
      this.logger.warn("end-conversation call failed (best-effort, not retried)", {
        conversationId: this.conversationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Falls back to HUMAN_FALLBACK_NUMBER (the kill switch's own destination,
   * env.schema.ts) when EMERGENCY_TRANSFER_NUMBER specifically isn't set —
   * env.schema.ts's own `validate()` now fails BOOT if neither is
   * configured while AI_RECEPTIONIST_ENABLED is true, so the log-and-no-op
   * branch below is defense-in-depth against that invariant somehow not
   * holding (this method reads raw `process.env`, not the validated `Env`
   * object, so it can't see that check's own guarantee directly), never
   * the expected path in a correctly configured deployment. A dedicated
   * emergency number is still the right operational choice (it can route
   * to on-call dispatch rather than whatever general line
   * HUMAN_FALLBACK_NUMBER points at), but "some real human destination" is
   * strictly better than "silently keep talking to the caller as if
   * nothing happened" — which is what shipped here before this fix, found
   * live: EMERGENCY_TRANSFER_NUMBER was unset in this repo's own local
   * .env with no schema validation to catch it.
   *
   * `resolvedOnCallDestination`: the real, currently-on-call phone number
   * core-api resolved server-side (docs/07 §5.3's on-call rotation —
   * ResolveOnCallUseCase, fully built and tested but never actually wired
   * into a live call transfer before this fix, found while tracing the
   * complete "does a real human get contacted" path end to end). Preferred
   * over the static env-var chain when present: it reflects who is
   * ACTUALLY on call right now, not a single fixed number every emergency
   * rings regardless of time of day or rotation. `null` (no rotation
   * configured, no active shift, resolution itself failed) falls through
   * to the exact same static chain this method already had — this fix
   * only adds a better destination when one is available, it never
   * removes the existing guaranteed fallback.
   */
  private async executeEmergencyTransfer(
    params: CallSessionParams,
    log: StructuredLogger,
    resolvedOnCallDestination: string | null,
  ): Promise<void> {
    const destination =
      resolvedOnCallDestination ||
      process.env["EMERGENCY_TRANSFER_NUMBER"] ||
      process.env["HUMAN_FALLBACK_NUMBER"];
    if (!destination) {
      log.error(
        "escalateEmergency signaled forward_call but neither EMERGENCY_TRANSFER_NUMBER nor HUMAN_FALLBACK_NUMBER is configured — cannot execute transfer",
        { conversationId: this.conversationId },
      );
      return;
    }
    try {
      await this.callTransfer.transferCall(params.callSid, destination);
    } catch (error) {
      log.error("emergency call transfer failed", {
        conversationId: this.conversationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async speak(text: string, sink: MediaStreamSink): Promise<void> {
    const abortController = new AbortController();
    this.ttsAbort = abortController;
    this.ttsPlaying = true;
    // Temporary timing visibility (same diagnostic pass as the turn
    // round-trip log above) — this had zero timing anywhere before,
    // splitting a real "feels slow" report into "was it the turn's HTTP
    // round-trip or was it TTS?" was previously impossible from logs.
    const startedAt = Date.now();
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    try {
      for await (const chunk of this.tts.synthesize(text, abortController.signal)) {
        if (abortController.signal.aborted) {
          break;
        }
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
        }
        chunkCount += 1;
        sink.sendAudio(chunk);
      }
    } catch (error) {
      this.logger.warn("TTS synthesis failed mid-utterance", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ttsPlaying = false;
      if (this.ttsAbort === abortController) {
        this.ttsAbort = null;
      }
      this.logger.info("TTS synthesis finished", {
        timeToFirstChunkMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
        totalMs: Date.now() - startedAt,
        chunkCount,
        aborted: abortController.signal.aborted,
      });
    }
  }

  private async speakApologyAndClose(sink: MediaStreamSink): Promise<void> {
    // A prior turn's silence check-in could still be armed (e.g. an STT
    // session error arriving after a normal turn already armed it) — no
    // point leaving it pending once the call is ending regardless.
    this.disarmSilenceCheckIn();
    try {
      await this.speak(
        "We're sorry, we're unable to take your call right now. Please try again shortly.",
        sink,
      );
    } finally {
      this.ended = true;
      sink.close();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
