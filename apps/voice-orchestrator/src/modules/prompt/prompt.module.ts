import { Module } from "@nestjs/common";
import { AssembleSystemPromptUseCase } from "./application/assemble-system-prompt.use-case";
import { AGENT_PROFILE_PROVIDER } from "./domain/agent-profile";
import { StaticAgentProfileProvider } from "./infrastructure/static-agent-profile.provider";

@Module({
  providers: [
    { provide: AGENT_PROFILE_PROVIDER, useClass: StaticAgentProfileProvider },
    AssembleSystemPromptUseCase,
  ],
  exports: [AssembleSystemPromptUseCase],
})
export class PromptModule {}
