import { Inject, Injectable, type BeforeApplicationShutdown } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { FastifyInstance } from "fastify";
import type { WebsocketHandler } from "@fastify/websocket";
import type WebSocket from "ws";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { CallSessionOrchestrator } from "../../call-session/application/call-session-orchestrator";
import type { CallSessionParams } from "../../call-session/domain/call-session";
import type { MediaStreamSink } from "../../call-session/domain/media-stream-sink.port";
import {
  buildTwilioClearMessage,
  buildTwilioMarkMessage,
  buildTwilioMediaMessage,
  parseTwilioMessage,
} from "../domain/twilio-media-stream.types";
import { verifyMediaStreamToken } from "../infrastructure/media-stream-auth.util";

/**
 * Registers a raw `@fastify/websocket` route directly on the underlying
 * Fastify instance (main.ts calls `.register(this)` at bootstrap) rather
 * than as a Nest `@WebSocketGateway()` — Nest's own WS gateway abstraction
 * targets socket.io/ws as a SEPARATE transport concept layered over HTTP,
 * whereas Twilio's Media Streams protocol is a plain `ws` upgrade on a
 * specific path with a hand-rolled JSON+base64 message format (see
 * twilio-media-stream.types.ts) that gets nothing from socket.io's
 * room/namespace/ack machinery. `@fastify/websocket` reuses the SAME
 * Fastify server this service already runs (`@nestjs/platform-fastify`),
 * keeping this to one HTTP framework, not two — the explicit reason this
 * build avoids pulling in `@nestjs/websockets` + `socket.io` as a second
 * dependency stack for a single endpoint.
 *
 * ONE `CallSessionOrchestrator` PER CONNECTION: `moduleRef.resolve(...)`
 * (not `.get(...)`) creates a fresh instance from Nest's DI container per
 * call, matching CallSessionOrchestrator's own per-call state (conversationId,
 * in-flight AbortControllers) — see call-session.module.ts's comment.
 * This ONLY actually works because CallSessionOrchestrator itself is
 * `@Injectable({ scope: Scope.TRANSIENT })` — `resolve()` on a
 * DEFAULT-scoped provider returns the same shared singleton every call,
 * not a fresh one; found live as a real bug (see that class's own
 * comment for the exact failure this caused), not a hypothetical one.
 */
/**
 * How long shutdown waits for calls already in progress to finish before
 * giving up on them. Read from `process.env` at call time (same
 * convention as call-session-orchestrator.ts's own
 * `silenceCheckInTimeoutMs`) so tests can drop it to a few milliseconds
 * instead of holding a real 30s timer open.
 *
 * 30s is a deliberate compromise, not a measured constant: long enough
 * for a caller mid-sentence to be answered and wrapped up, short enough
 * to stay inside the grace period a platform allows between SIGTERM and
 * SIGKILL (Fly's default is 5s and must be raised — see `kill_timeout`
 * in fly.toml — or the platform kills the process before this can
 * finish, making the drain pointless).
 */
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
function drainTimeoutMs(): number {
  const raw = process.env["SHUTDOWN_DRAIN_TIMEOUT_MS"];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DRAIN_TIMEOUT_MS;
}

@Injectable()
export class MediaStreamGateway implements BeforeApplicationShutdown {
  /**
   * Every call currently on this process. Exists ONLY so shutdown can
   * wait for them — found live, the hard way: `app.close()` tore every
   * in-progress call down mid-sentence, because nothing here knew a call
   * was in progress at all. On a laptop that was a one-off; on a
   * platform that sends SIGTERM for every deploy, restart and autoscale
   * event it is routine, and the caller simply hears the line die.
   */
  private readonly activeCalls = new Set<WebSocket>();
  /** Set once SIGTERM arrives — new connections are refused from then on, so a machine on its way out never accepts a call it can't finish. */
  private draining = false;
  private drainWaiters: Array<() => void> = [];

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  register(fastify: FastifyInstance): void {
    fastify.get(
      "/media-stream",
      { websocket: true },
      this.handleConnection.bind(this) as WebsocketHandler,
    );
  }

  /**
   * `beforeApplicationShutdown`, NOT `onApplicationShutdown` — Nest runs
   * the former while the HTTP server is still listening and the latter
   * only after it has been torn down. Draining is only meaningful in the
   * window where the sockets are still open, so the hook choice here is
   * load-bearing, not stylistic.
   */
  async beforeApplicationShutdown(signal?: string): Promise<void> {
    this.draining = true;
    const inFlight = this.activeCalls.size;
    if (inFlight === 0) {
      this.logger.info("shutdown: no calls in progress, exiting immediately", { signal });
      return;
    }
    const timeoutMs = drainTimeoutMs();
    this.logger.info("shutdown: draining calls in progress before exit", {
      signal,
      inFlight,
      timeoutMs,
    });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // Deliberately does NOT force-close the stragglers: letting
        // Nest's own teardown do that keeps one owner of socket
        // lifecycle, and a caller whose call is cut at the deadline is
        // no worse off than before this drain existed.
        this.logger.warn("shutdown: drain timed out, some calls will be cut", {
          signal,
          stillActive: this.activeCalls.size,
        });
        resolve();
      }, timeoutMs);
      // Without unref the timer alone keeps the event loop alive for the
      // full timeout even once every call has already hung up.
      timer.unref?.();
      this.drainWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.logger.info("shutdown: drain complete", { signal });
  }

  private trackCall(socket: WebSocket): void {
    this.activeCalls.add(socket);
  }

  private untrackCall(socket: WebSocket): void {
    if (!this.activeCalls.delete(socket)) {
      return;
    }
    if (this.activeCalls.size === 0 && this.drainWaiters.length > 0) {
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      for (const wake of waiters) {
        wake();
      }
    }
  }

  private async handleConnection(
    connection: { socket: WebSocket },
    _request: unknown,
  ): Promise<void> {
    const socket = connection.socket;

    // Refuse work on a process that is on its way out. Twilio retries a
    // failed Media Stream connection, and the platform routes that retry
    // to a machine that is still accepting — so closing here costs the
    // caller a reconnect, whereas accepting would strand them on a
    // process about to exit.
    if (this.draining) {
      this.logger.warn("refusing new media stream — this process is shutting down");
      socket.close();
      return;
    }

    const orchestrator = await this.moduleRef.resolve(CallSessionOrchestrator, undefined, {
      strict: false,
    });

    let params: CallSessionParams | null = null;
    let log = this.logger;

    const sink: MediaStreamSink = {
      sendAudio: (chunk) => {
        if (params) {
          socket.send(buildTwilioMediaMessage(params.streamSid, chunk));
        }
      },
      clearQueuedAudio: () => {
        if (params) {
          socket.send(buildTwilioClearMessage(params.streamSid));
        }
      },
      sendMark: (name) => {
        if (params) {
          socket.send(buildTwilioMarkMessage(params.streamSid, name));
        }
      },
      close: () => socket.close(),
    };

    socket.on("message", (raw: Buffer) => {
      const message = parseTwilioMessage(raw.toString());
      if (!message) {
        return;
      }

      if (message.event === "start") {
        const custom = message.start.customParameters ?? {};
        log = this.logger.child({
          tenantId: custom["tenantId"] ?? "",
          callId: custom["callId"] ?? "",
        });

        // FOUND LIVE via a QA security audit: this raw WebSocket route has
        // no authentication of its own — anyone reaching the public URL
        // could previously open a connection and send a forged `start`
        // event with an arbitrary tenantId/businessId/callerAni, bypassing
        // TwilioSignatureGuard (which only protects the webhook POST, a
        // completely separate HTTP request) entirely. See
        // media-stream-auth.util.ts's own comment for the full exploit and
        // fix. This MUST run before `params` is trusted for anything,
        // including the existing missing-field check below — a forged
        // connection with all required fields present but no valid token
        // must still be rejected.
        const authToken = process.env["TWILIO_AUTH_TOKEN"];
        const signedParams = {
          callId: custom["callId"] ?? "",
          tenantId: custom["tenantId"] ?? "",
          businessId: custom["businessId"] ?? "",
          callerAni: custom["callerAni"] ?? "",
          toNumber: custom["toNumber"] ?? "",
          timezone: custom["timezone"] ?? "",
        };
        const providedToken = custom["mediaStreamToken"];
        if (
          !authToken ||
          typeof providedToken !== "string" ||
          providedToken.length === 0 ||
          !verifyMediaStreamToken(signedParams, providedToken, authToken)
        ) {
          log.error(
            "Media Stream start event failed authentication — missing or invalid mediaStreamToken, closing without ever starting a call",
          );
          socket.close();
          return;
        }

        params = {
          callId: signedParams.callId,
          tenantId: signedParams.tenantId,
          businessId: signedParams.businessId,
          callerAni: signedParams.callerAni,
          toNumber: signedParams.toNumber || undefined,
          timezone: signedParams.timezone || undefined,
          callSid: message.start.callSid,
          streamSid: message.start.streamSid,
        };
        log = this.logger.child({ tenantId: params.tenantId, callId: params.callId });
        if (!params.callId || !params.tenantId || !params.businessId || !params.callerAni) {
          // Twilio's own Stream <Parameter> delivery failed to round-trip
          // what twiml.builder.ts sent — this should be unreachable in
          // normal operation (same call this service issued the TwiML
          // for), but a live call must never hang silently on a malformed
          // start event.
          log.error("Media Stream start event missing required customParameters — closing", {
            customParameters: custom,
          });
          socket.close();
          return;
        }
        log.info("media stream started", { streamSid: params.streamSid, callSid: params.callSid });
        // Tracked from the authenticated `start` onward, not from socket
        // open: a connection that never sends a valid start event isn't a
        // call, and holding shutdown open for one would let an unauthenticated
        // probe delay every deploy.
        this.trackCall(socket);
        orchestrator.onCallStart(params, sink).catch((error: unknown) => {
          log.error("onCallStart failed unexpectedly", {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      if (message.event === "media") {
        // The single most serious bug found testing a real live call: a
        // bidirectional <Connect><Stream> echoes back everything THIS
        // service sends the caller as its own "outbound"-track media
        // event, on the exact same channel as the caller's real
        // "inbound" audio — verified against Twilio's own Media Streams
        // docs, not guessed. Forwarding every media event unfiltered (as
        // this did before) fed the AI's own TTS output back into its own
        // speech recognition, continuously, for the whole call —
        // Deepgram's VAD correctly detected near-constant "speech" (real
        // audio energy, just half of it our own voice) but could never
        // produce a coherent transcript from audio that was actually the
        // caller and the AI talking over each other from Deepgram's
        // point of view. This is what a real call actually surfaced as
        // "no response for 30-40 seconds" — not a timeout or retry
        // issue, a self-poisoned transcript that could only occasionally
        // resolve to real text by chance.
        if (message.media.track === "inbound") {
          orchestrator.onAudioFrame(Buffer.from(message.media.payload, "base64"));
        }
        return;
      }

      if (message.event === "stop") {
        if (params) {
          orchestrator.onCallEnd(params, "caller_hangup").catch((error: unknown) => {
            log.warn("onCallEnd failed (best-effort)", {
              reason: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    });

    socket.on("close", () => {
      // Untrack on close rather than on the `stop` event: `stop` doesn't
      // arrive on a raw network drop, and a call that never releases its
      // slot would hold shutdown open for the full drain timeout.
      this.untrackCall(socket);
      if (params) {
        // Twilio's own `stop` event normally arrives before the socket
        // closes, making this a no-op double-call (onCallEnd's `this.ended`
        // guard in CallSessionOrchestrator makes that safe) — but a raw
        // network drop can close the socket WITHOUT a documented `stop`
        // event ever arriving, and that path must not leave the
        // conversation open forever on voice-orchestrator's side.
        orchestrator.onCallEnd(params, "runtime_disconnected").catch(() => undefined);
      }
    });

    socket.on("error", (error: Error) => {
      log.warn("media stream socket error", { reason: error.message });
    });
  }
}
