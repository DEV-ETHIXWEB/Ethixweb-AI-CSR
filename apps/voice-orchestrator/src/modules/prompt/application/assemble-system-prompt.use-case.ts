import { Inject, Injectable } from "@nestjs/common";
import {
  AGENT_PROFILE_PROVIDER,
  type AgentProfile,
  type AgentProfileProvider,
} from "../domain/agent-profile";
import { assembleLayeredPrompt, PLATFORM_BASE_PROMPT_V1 } from "../domain/prompt-layers";
import { formatRuntimeContext, type RuntimeContext } from "../domain/runtime-context";

export interface AssembledPrompt {
  systemPrompt: string;
  profile: AgentProfile;
}

/** The application-layer entry point for docs/03 §1's four-layer prompt assembly. */
@Injectable()
export class AssembleSystemPromptUseCase {
  constructor(
    @Inject(AGENT_PROFILE_PROVIDER) private readonly agentProfileProvider: AgentProfileProvider,
  ) {}

  async execute(
    tenantId: string,
    businessId: string,
    runtimeContext: RuntimeContext,
  ): Promise<AssembledPrompt> {
    const profile = await this.agentProfileProvider.getActiveProfile(tenantId, businessId);
    const systemPrompt = assembleLayeredPrompt({
      platformBase: PLATFORM_BASE_PROMPT_V1,
      tenantDefault: profile.tenantDefaultPrompt,
      businessOverride: profile.businessOverridePrompt,
      runtimeContext: formatRuntimeContext(runtimeContext),
    });
    return { systemPrompt, profile };
  }
}
