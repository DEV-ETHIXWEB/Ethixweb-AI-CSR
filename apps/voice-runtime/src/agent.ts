import { fileURLToPath } from "node:url";
import { createLogger } from "@ethixweb/shared-kernel";
import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  cli,
  defineAgent,
  ServerOptions,
  workflows,
  type JobContext,
} from "@livekit/agents";
import * as cartesia from "@livekit/agents-plugin-cartesia";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as silero from "@livekit/agents-plugin-silero";
import { CallSession, type TransferExecutor } from "./call-session.js";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { HealthServer } from "./health-server.js";
import { OrchestratorClient } from "./orchestrator-client.js";

/**
 * SIP participant attributes LiveKit attaches for an inbound call — the
 * caller's number (ANI) and the dialed number (DID). Used only for the
 * pilot's single-tenant call metadata passed to voice-orchestrator's
 * `POST /` (docs/24 §2.1); no DID->tenant lookup exists yet (see config.ts).
 */
const SIP_CALLER_NUMBER_ATTR = "sip.phoneNumber";
const SIP_DIALED_NUMBER_ATTR = "sip.trunkPhoneNumber";
/** Only ever reached outside a real SIP call (LiveKit's own local dev/test tooling has no SIP leg) — never a real caller. */
const NON_SIP_TEST_FALLBACK_ANI = "+10000000000";

function mapCloseReasonToEndReason(reason: string): string {
  switch (reason) {
    case "participant_disconnected":
      return "caller_hangup";
    case "job_shutdown":
      return "worker_shutdown";
    case "error":
      return "runtime_error";
    case "user_initiated":
      return "call_ended_signal";
    default:
      return reason;
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const config = loadConfig();
    const logger = createLogger({ serviceName: "voice-runtime" });
    const orchestrator = new OrchestratorClient(
      config.orchestratorBaseUrl,
      config.orchestratorServiceToken,
    );

    // Constructed before transferExecutor/agent below, purely so
    // transferExecutor's closure can capture it directly (a real transfer
    // only ever fires from inside a turn, which can't happen until after
    // session.start() runs at the bottom of this function).
    const session = new AgentSession({
      stt: new deepgram.STT({ apiKey: config.deepgramApiKey, model: config.deepgramModel }),
      tts: new cartesia.TTS({
        apiKey: config.cartesiaApiKey,
        model: config.cartesiaModel,
        voice: config.cartesiaVoice,
      }),
      vad: await silero.VAD.load(),
    });

    const transferExecutor: TransferExecutor = async (targets) => {
      const target = targets[0];
      if (!target) {
        return;
      }
      // docs/02 §4: WarmTransferTask places the caller on hold, dials the
      // on-call target over SIP, briefs them with the live conversation
      // context, and merges on confirmation. Requires a LiveKit outbound
      // SIP trunk provisioned separately from the inbound trunk this
      // runtime answers on — see docs/27-voice-runtime-provisioning.md.
      await new workflows.WarmTransferTask({
        sipCallTo: target,
        chatCtx: session.chatCtx,
      }).run();
    };

    const callSession = new CallSession({ orchestrator, config, transferExecutor, logger });

    const agent = Agent.create({
      // Never actually sent to an LLM — llmNode below fully replaces the
      // model call with voice-orchestrator's HTTP contract. Required by
      // AgentOptions regardless; kept honest about what it is.
      instructions:
        "Unused placeholder — llmNode delegates every turn to voice-orchestrator, docs/24.",
      llmNode: callSession.createLlmNode(),
    });

    // docs/24 §2.3 mechanism 2: caller speaks while TTS is still playing
    // between turns (no turn HTTP call in flight) — signal voice-orchestrator
    // directly. Mechanism 1 (mid-turn abort) lives in CallSession.runTurn's
    // own AbortController, triggered by the same handleBargeIn() call.
    session.on(AgentSessionEventTypes.UserStateChanged, (ev) => {
      if (ev.newState === "speaking" && session.agentState === "speaking") {
        callSession.handleBargeIn();
      }
    });

    session.on(AgentSessionEventTypes.Close, (ev) => {
      callSession.end(mapCloseReasonToEndReason(ev.reason)).catch((error: unknown) => {
        logger.error("failed to end conversation on session close", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    });

    const participant = await ctx.waitForParticipant();
    const callerAni = participant.attributes[SIP_CALLER_NUMBER_ATTR];
    const toNumber = participant.attributes[SIP_DIALED_NUMBER_ATTR];
    if (!callerAni) {
      logger.warn("no sip.phoneNumber attribute — not a real SIP call, using test fallback ANI");
    }

    // Must complete BEFORE session.start(): the conversation has to exist
    // in voice-orchestrator before the pipeline can generate any turn.
    await callSession.start(callerAni ?? NON_SIP_TEST_FALLBACK_ANI, toNumber);
    await session.start({ agent, room: ctx.room });
  },
});

function startHealthServer(config: RuntimeConfig): HealthServer {
  const healthServer = new HealthServer();
  void healthServer.start(config.port).then(() => healthServer.setReady(true));
  process.on("SIGTERM", () => {
    // Flips readiness only — draining in-flight calls and process exit are
    // cli.runApp's own responsibility (ServerOptions.drainTimeout below);
    // this just stops the load balancer routing new calls here.
    healthServer.setReady(false);
  });
  return healthServer;
}

// Guards against @livekit/agents' own dynamic re-import of this same file
// (ServerOptions.agent) purely to extract the `defineAgent` default export
// above — without this guard, the health server would try to bind its port
// again in that context.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startHealthServer(loadConfig());
  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: "voice-runtime",
      drainTimeout: 30_000,
    }),
  );
}
