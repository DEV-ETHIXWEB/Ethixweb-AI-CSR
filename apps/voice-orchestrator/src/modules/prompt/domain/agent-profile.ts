/**
 * The orchestrator's view of `agent_configs` (packages/database/prisma/schema.prisma)
 * — that table's persistence and CRUD/versioning lifecycle belongs to
 * core-api (it's tenant/business-scoped Postgres data, and this service is
 * deliberately Postgres-free, see RedisService's own comment), so this is
 * a READ-shaped projection, not the entity itself. `AgentProfileProvider`
 * (the port below) is the seam; see StaticAgentProfileProvider's own
 * comment for what's actually wired today vs. deferred.
 */
export interface AgentProfile {
  tenantId: string;
  businessId: string;
  version: number;
  llmModel: string;
  /** docs/03 §1 TENANT DEFAULT layer — brand voice, default qualification questions. */
  tenantDefaultPrompt: string;
  /** docs/03 §1 BUSINESS OVERRIDE layer — business name, services offered, local emergency examples. */
  businessOverridePrompt: string;
  /** docs/03 §7 — a template with `{{variable}}` interpolation, not a hardcoded string. */
  closingTemplate: string;
  businessName: string;
}

export interface AgentProfileProvider {
  getActiveProfile(tenantId: string, businessId: string): Promise<AgentProfile>;
}

export const AGENT_PROFILE_PROVIDER = Symbol("AGENT_PROFILE_PROVIDER");
