import { Module } from "@nestjs/common";
import { OrchestratorClientModule } from "../orchestrator-client/orchestrator-client.module";
import { SpeechModule } from "../speech/speech.module";
import { TelephonyInfrastructureModule } from "../telephony/telephony-infrastructure.module";
import { CallSessionOrchestrator } from "./application/call-session-orchestrator";

/**
 * `CallSessionOrchestrator` is intentionally NOT a singleton provider here
 * despite Nest's default DEFAULT scope making it effectively one per
 * process — each live phone call needs its OWN instance (own
 * conversationId, own in-flight-turn AbortController, own TTS-playing
 * flag). The WebSocket gateway (telephony module, interfaces layer)
 * constructs a fresh `CallSessionOrchestrator` per connection via this
 * module's exported provider factory rather than injecting a shared
 * instance — see telephony/interfaces/media-stream.gateway.ts's own
 * comment for exactly how.
 */
@Module({
  imports: [OrchestratorClientModule, SpeechModule, TelephonyInfrastructureModule],
  providers: [CallSessionOrchestrator],
  exports: [
    CallSessionOrchestrator,
    OrchestratorClientModule,
    SpeechModule,
    TelephonyInfrastructureModule,
  ],
})
export class CallSessionModule {}
