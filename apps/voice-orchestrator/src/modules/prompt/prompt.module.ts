import { Module } from "@nestjs/common";
import { ToolBrokerModule } from "../tool-broker/tool-broker.module";
import { AssembleSystemPromptUseCase } from "./application/assemble-system-prompt.use-case";
import { AGENT_PROFILE_PROVIDER } from "./domain/agent-profile";
import { HttpAgentProfileProvider } from "./infrastructure/http-agent-profile.provider";

/**
 * Imports ToolBrokerModule for its exported `CORE_API_CLIENT` binding,
 * which HttpAgentProfileProvider needs to fetch approved ai-knowledge items
 * — same import-direction reasoning CapacityModule's own comment already
 * verified (ToolBrokerModule imports nothing from this module either,
 * directly or transitively), so this is a fourth consumer of that binding,
 * not a new pattern.
 */
@Module({
  imports: [ToolBrokerModule],
  providers: [
    { provide: AGENT_PROFILE_PROVIDER, useClass: HttpAgentProfileProvider },
    AssembleSystemPromptUseCase,
  ],
  exports: [AssembleSystemPromptUseCase],
})
export class PromptModule {}
