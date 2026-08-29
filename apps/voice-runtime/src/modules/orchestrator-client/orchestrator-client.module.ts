import { Module } from "@nestjs/common";
import { ORCHESTRATOR_CLIENT } from "./domain/orchestrator-client.port";
import { HttpOrchestratorClient } from "./infrastructure/http-orchestrator-client";

@Module({
  providers: [{ provide: ORCHESTRATOR_CLIENT, useClass: HttpOrchestratorClient }],
  exports: [ORCHESTRATOR_CLIENT],
})
export class OrchestratorClientModule {}
