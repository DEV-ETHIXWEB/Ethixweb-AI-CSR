import { Injectable } from "@nestjs/common";
import type { AgentProfile, AgentProfileProvider } from "../domain/agent-profile";
import { DEFAULT_CLOSING_TEMPLATE } from "../domain/closing-script";

export const DEFAULT_LLM_MODEL = "gpt-4o";
export const DEFAULT_BRAND_VOICE_PROMPT =
  "Brand voice: warm, direct, no corporate filler. Avoid the words " +
  '"unfortunately" and "I apologize for the inconvenience" — use plain ' +
  'human phrasing instead ("ah, that\'s rough" / "let\'s get that sorted").';

/**
 * TECHNICAL DEBT, flagged deliberately rather than hidden: `agent_configs`
 * (packages/database/prisma/schema.prisma) is real, tenant/business-scoped,
 * versioned Postgres data — but no core-api module currently exposes it
 * (docs/13's backlog has no `agent-configs` section; it's an unclaimed
 * table). Building full CRUD/versioning for it remains out of scope here —
 * this provider returns sensible platform defaults for `tenantDefaultPrompt`
 * /`closingTemplate`/`llmModel`/`businessName`. Swap this class for an HTTP
 * client against a future `GET /internal/agent-configs/active` endpoint once
 * core-api exposes one; `AgentProfileProvider` is the seam designed in for
 * exactly that swap, per docs/21-provider-abstraction-and-vendor-risk.md's
 * general "the port doesn't change when the implementation does" principle.
 *
 * This class is now only the fallback binding (still used if core-api is
 * unreachable, see HttpAgentProfileProvider's own comment) — the default
 * binding is HttpAgentProfileProvider, which additionally fetches approved
 * `aiKnowledge`-flagged knowledge items via core-api's now-real
 * `GET /internal/knowledge/:businessId/ai-knowledge` route and folds them
 * into `businessOverridePrompt`, closing that half of this class's original
 * gap.
 */
@Injectable()
export class StaticAgentProfileProvider implements AgentProfileProvider {
  async getActiveProfile(tenantId: string, businessId: string): Promise<AgentProfile> {
    return {
      tenantId,
      businessId,
      version: 1,
      llmModel: process.env["DEFAULT_LLM_MODEL"] ?? DEFAULT_LLM_MODEL,
      tenantDefaultPrompt: DEFAULT_BRAND_VOICE_PROMPT,
      businessOverridePrompt: "",
      closingTemplate: DEFAULT_CLOSING_TEMPLATE,
      businessName: "the office",
    };
  }
}
