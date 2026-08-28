import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
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
 * The one class that actually drives a phone call end to end — receives
 * Twilio Media Stream lifecycle events + STT results from the WebSocket
 * gateway (interfaces layer, which owns nothing but wiring this class to a
 * real `ws` connection) and turns them into the exact sequence docs/28
 * §J/§K/§L/§M specify. Everything below maps directly to a numbered
 * section of that contract — see each method's own comment for the
 * specific citation.
 */
@Injectable()
export class CallSessionOrchestrator {
  private conversationId: string | null = null;
  private sttSession: SpeechToTextSession | null = null;
  private activeTurnAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsPlaying = false;
  private ended = false;

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
   */
  async onCallStart(params: CallSessionParams, sink: MediaStreamSink): Promise<void> {
    const log = this.logger.child({ tenantId: params.tenantId, callId: params.callId });

    try {
      const conversation = await this.orchestrator.startConversation({
        tenantId: params.tenantId,
        businessId: params.businessId,
        callId: params.callId,
        callerAni: params.callerAni,
        toNumber: params.toNumber,
        timezone: params.timezone,
      });
      this.conversationId = conversation.id;
      log.info("conversation started", { conversationId: conversation.id });
    } catch (error) {
      if (error instanceof OrchestratorConflictError) {
        // docs/28 §B.1's 409 case: a retried start for a callId that
        // actually succeeded the first time. Per §I's documented gap,
        // there is no lookup-by-callId route — this runtime's process
        // model (one CallSessionOrchestrator instance per live WebSocket
        // connection, never restarted mid-call, see class-level comment)
        // means this path is unreachable in normal operation, not silently
        // swallowed: if it IS reached, the call cannot be recovered, so it
        // fails the same way any other start failure does below.
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
    this.sttSession.onSpeechStarted(() => this.handleBargeIn(params, sink));
    this.sttSession.onError((error) => {
      log.warn("STT session error", { reason: error.message });
    });
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
   */
  private async handleFinalTranscript(
    params: CallSessionParams,
    sink: MediaStreamSink,
    result: { transcript: string; confidence: number },
  ): Promise<void> {
    if (!this.conversationId || this.ended) {
      return;
    }
    const log = this.logger.child({ tenantId: params.tenantId, callId: params.callId });
    const idempotencyKey = randomUUID();
    const conversationId = this.conversationId;

    let turnResult: TurnResult | null = null;
    let capacityAttempts = 0;
    let turnAttempts = 0;

    while (turnResult === null) {
      const abortController = new AbortController();
      this.activeTurnAbort = abortController;

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
        );
      } catch (error) {
        if (abortController.signal.aborted) {
          // Barge-in fired mid-turn (docs/28 §B.3 mechanism 1) — the caller
          // is already speaking their next utterance, which will itself
          // produce a new finalized transcript and a new turn. Silently
          // drop this one rather than retrying or speaking anything.
          this.activeTurnAbort = null;
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

    if (turnResult.escalation?.action === "forward_call") {
      log.info("emergency escalation signaled — executing call transfer (docs/28 §M)", {
        conversationId,
        severity: turnResult.escalation.severity,
      });
      // Speak first, THEN transfer — the caller should hear SOMETHING
      // before the line hands off, rather than silence during the
      // transfer's own connection setup latency. Best-effort: if the
      // transfer itself fails, the caller has at least heard the response
      // text and the call continues normally rather than dropping silently.
      if (turnResult.responseText) {
        await this.speak(turnResult.responseText, sink);
      }
      await this.executeEmergencyTransfer(params, log);
      return;
    }

    if (turnResult.responseText) {
      await this.speak(turnResult.responseText, sink);
    }
  }

  /**
   * docs/28 §B.3 — barge-in. Two mechanisms, both implemented, chosen
   * based on what's actually happening right now: if a turn HTTP call is
   * in flight, abort it directly (mechanism 1); otherwise, if TTS is
   * playing between turns, call the lighter-weight /interrupt endpoint
   * (mechanism 2). Either way, Twilio's own audio buffer is cleared so
   * queued-but-unplayed audio stops immediately — the HTTP-level
   * abort/interrupt alone does not silence audio Twilio already received.
   */
  private handleBargeIn(params: CallSessionParams, sink: MediaStreamSink): void {
    if (this.activeTurnAbort) {
      this.activeTurnAbort.abort();
      this.activeTurnAbort = null;
    }
    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }
    if (this.ttsPlaying) {
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
    await this.sttSession?.close().catch(() => undefined);

    if (!this.conversationId) {
      return;
    }
    try {
      await this.orchestrator.endConversation(this.conversationId, {
        tenantId: params.tenantId,
        endReason,
      });
    } catch (error) {
      this.logger.warn("end-conversation call failed (best-effort, not retried)", {
        conversationId: this.conversationId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async executeEmergencyTransfer(
    params: CallSessionParams,
    log: StructuredLogger,
  ): Promise<void> {
    const destination = process.env["EMERGENCY_TRANSFER_NUMBER"];
    if (!destination) {
      log.error(
        "escalateEmergency signaled forward_call but EMERGENCY_TRANSFER_NUMBER is not configured — cannot execute transfer",
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
    try {
      for await (const chunk of this.tts.synthesize(text, abortController.signal)) {
        if (abortController.signal.aborted) {
          break;
        }
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
    }
  }

  private async speakApologyAndClose(sink: MediaStreamSink): Promise<void> {
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
