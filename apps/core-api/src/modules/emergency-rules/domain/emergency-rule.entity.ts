/** docs/06-database-schema.md EMERGENCY_RULES / docs/07 §5.1. */
export const EMERGENCY_SEVERITIES = ["critical", "high", "medium"] as const;
export type EmergencySeverity = (typeof EMERGENCY_SEVERITIES)[number];

export const EMERGENCY_ACTIONS = ["forward_call", "priority_notify", "standard_lead"] as const;
export type EmergencyAction = (typeof EMERGENCY_ACTIONS)[number];

export interface EmergencyRule {
  id: string;
  tenantId: string;
  businessId: string;
  keywordOrPattern: string;
  severity: string;
  escalationAction: string;
  isActive: boolean;
}

/**
 * docs/07 §5.1's seeded default keyword table — "seed defaults, not
 * hardcoded logic": used only when a business hasn't configured any
 * `EmergencyRule` rows of its own yet (see EscalateEmergencyUseCase), so a
 * tenant's own configured rules always take precedence over this list, and
 * a business can freely remove/override every entry here from its own
 * data. Not a migration seed script — this codebase's Prisma migrations
 * require live Postgres access this environment doesn't have (same
 * constraint noted throughout this build) — so it lives as the documented
 * in-code default until a real seed migration is run.
 */
export const DEFAULT_EMERGENCY_KEYWORDS: ReadonlyArray<{
  pattern: string;
  severity: EmergencySeverity;
  action: EmergencyAction;
}> = [
  { pattern: "burst pipe", severity: "critical", action: "forward_call" },
  { pattern: "pipe burst", severity: "critical", action: "forward_call" },
  { pattern: "gas leak", severity: "critical", action: "forward_call" },
  { pattern: "smell gas", severity: "critical", action: "forward_call" },
  { pattern: "smell of gas", severity: "critical", action: "forward_call" },
  { pattern: "sewer backup", severity: "critical", action: "forward_call" },
  { pattern: "sewage backup", severity: "critical", action: "forward_call" },
  { pattern: "flooding", severity: "critical", action: "forward_call" },
  { pattern: "flooded", severity: "critical", action: "forward_call" },
  { pattern: "water everywhere", severity: "critical", action: "forward_call" },
  { pattern: "no hot water", severity: "high", action: "priority_notify" },
  { pattern: "no water", severity: "high", action: "priority_notify" },
  { pattern: "overflowing toilet", severity: "high", action: "priority_notify" },
  { pattern: "toilet overflowing", severity: "high", action: "priority_notify" },
  { pattern: "water heater leaking", severity: "medium", action: "priority_notify" },
];
