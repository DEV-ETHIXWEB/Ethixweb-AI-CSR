import { Injectable } from "@nestjs/common";
import type { AgentProfile, AgentProfileProvider } from "../domain/agent-profile";
import { DEFAULT_CLOSING_TEMPLATE } from "../domain/closing-script";

const DEFAULT_LLM_MODEL = "gpt-4o";

/**
 * TECHNICAL DEBT, flagged deliberately rather than hidden: `agent_configs`
 * (packages/database/prisma/schema.prisma) is real, tenant/business-scoped,
 * versioned Postgres data — but no core-api module currently exposes it
 * (docs/13's backlog has no `agent-configs` section; it's an unclaimed
 * table, the same state `leads`/`agent_configs` itself was in before this
 * phase). Building full CRUD/versioning for it is out of scope for "only
 * the orchestrator" (this phase's explicit instruction) — so this provider
 * returns sensible platform defaults for now. Swap this class for an HTTP
 * client against a future `GET /internal/agent-configs/active` endpoint
 * once core-api exposes one; `AgentProfileProvider` is the seam designed
 * in for exactly that swap, per docs/21-provider-abstraction-and-vendor-risk.md's
 * general "the port doesn't change when the implementation does" principle.
 */
@Injectable()
export class StaticAgentProfileProvider implements AgentProfileProvider {
  async getActiveProfile(tenantId: string, businessId: string): Promise<AgentProfile> {
    return {
      tenantId,
      businessId,
      version: 1,
      llmModel: process.env["DEFAULT_LLM_MODEL"] ?? DEFAULT_LLM_MODEL,
      tenantDefaultPrompt:
        "Brand voice: warm, direct, no corporate filler. Avoid the words " +
        '"unfortunately" and "I apologize for the inconvenience" — use plain ' +
        'human phrasing instead ("ah, that\'s rough" / "let\'s get that sorted").',
      businessOverridePrompt: "",
      closingTemplate: DEFAULT_CLOSING_TEMPLATE,
      businessName: "the office",
    };
  }
}
