import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
import type { AgentProfile, AgentProfileProvider } from "../domain/agent-profile";
import { DEFAULT_CLOSING_TEMPLATE } from "../domain/closing-script";
import { DEFAULT_BRAND_VOICE_PROMPT, DEFAULT_LLM_MODEL } from "./static-agent-profile.provider";

/** core-api's `GET /internal/knowledge/:businessId/ai-knowledge` response shape (knowledge module's AiKnowledgeItemResponseDto[], core-api repo). */
interface AiKnowledgeItemApiResponse {
  id: string;
  category: string;
  title: string;
  content: string;
  priority: number;
}

/**
 * The swap StaticAgentProfileProvider's own comment anticipated, for the
 * `aiKnowledge`-flagged half of that gap: core-api's knowledge module
 * (docs/38) has always had the CRUD/approval lifecycle and the
 * `listApprovedForRuntime` repository method to serve it — the only missing
 * piece was an HTTP route on the runtime-facing side
 * (`GET /internal/knowledge/:businessId/ai-knowledge`, added alongside this
 * provider) and this consumer.
 *
 * `agent_configs` itself (tenant/business default + override prompt text,
 * closing template, LLM model choice) still has no core-api module exposing
 * it — that half of StaticAgentProfileProvider's original comment remains
 * genuinely unclaimed, so those fields keep the same platform-default
 * fallback values that class already used. This provider's real change is
 * additive: approved AI-knowledge content is appended as its own labeled
 * section of `businessOverridePrompt` rather than left as an empty string.
 *
 * CRITICAL: sits on StartConversationUseCase's system-prompt-assembly hot
 * path, called on every call start. A core-api outage must never throw out
 * of this provider — the knowledge fetch is caught independently and
 * degrades to the same empty-override behavior StaticAgentProfileProvider
 * always had, never blocking call start over a knowledge-fetch failure.
 */
@Injectable()
export class HttpAgentProfileProvider implements AgentProfileProvider {
  private readonly logger = new Logger(HttpAgentProfileProvider.name);

  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async getActiveProfile(tenantId: string, businessId: string): Promise<AgentProfile> {
    const businessOverridePrompt = await this.fetchApprovedKnowledgeSection(tenantId, businessId);
    return {
      tenantId,
      businessId,
      version: 1,
      llmModel: process.env["DEFAULT_LLM_MODEL"] ?? DEFAULT_LLM_MODEL,
      tenantDefaultPrompt: DEFAULT_BRAND_VOICE_PROMPT,
      businessOverridePrompt,
      closingTemplate: DEFAULT_CLOSING_TEMPLATE,
      businessName: "the office",
    };
  }

  private async fetchApprovedKnowledgeSection(
    tenantId: string,
    businessId: string,
  ): Promise<string> {
    try {
      const items = await this.coreApiClient.get<AiKnowledgeItemApiResponse[]>(
        `/internal/knowledge/${businessId}/ai-knowledge`,
      );
      if (!items || items.length === 0) {
        return "";
      }
      const sorted = [...items].sort((a, b) => a.priority - b.priority);
      const lines = sorted.map((item) => `- [${item.category}] ${item.title}: ${item.content}`);
      return [
        "Approved business knowledge (use only what's relevant to the caller's question):",
        ...lines,
      ].join("\n");
    } catch (error) {
      this.logger.warn(
        `core-api ai-knowledge fetch failed for tenant=${tenantId} business=${businessId}, falling back to no business-override content: ${String(error)}`,
      );
      return "";
    }
  }
}
