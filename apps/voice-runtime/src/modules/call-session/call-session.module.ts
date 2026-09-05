import { Module } from "@nestjs/common";
import { OrchestratorClientModule } from "../orchestrator-client/orchestrator-client.module";
import { SpeechModule } from "../speech/speech.module";
import { TelephonyInfrastructureModule } from "../telephony/telephony-infrastructure.module";
import { CallSessionOrchestrator } from "./application/call-session-orchestrator";

/**
 * `CallSessionOrchestrator` is `@Injectable({ scope: Scope.TRANSIENT })`
 * on its own class (see that file) — REQUIRED, not optional, for each
 * live phone call to get its own instance (own conversationId, own
 * in-flight-turn AbortController, own `ended` flag). This comment
 * previously claimed `moduleRef.resolve()` alone was sufficient "despite
 * Nest's default DEFAULT scope" — that was wrong, found live: for a
 * DEFAULT-scoped provider, `moduleRef.resolve()` returns the SAME shared
 * singleton every time, identical to `.get()`, only TRANSIENT/REQUEST
 * scope makes it create a genuinely new instance. Without TRANSIENT
 * scope, every call after the first one handled by a given running
 * process reused the previous call's instance — including its `ended`
 * flag already set `true` from the prior call's hangup — silently
 * breaking every turn of every subsequent call until the process
 * restarted. See media-stream.gateway.ts's own comment for exactly
 * where `moduleRef.resolve()` is called per connection.
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
