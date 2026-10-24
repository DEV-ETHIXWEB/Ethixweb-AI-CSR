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
  // 2026-10-24, Yash's test call: "oh wait my sink just exploded" (heard as
  // "sync") mid-call, and Grace went on asking for the septic tank address.
  { pattern: "exploded", severity: "critical", action: "forward_call" },
  { pattern: "blew up", severity: "critical", action: "forward_call" },
  { pattern: "flooded", severity: "critical", action: "forward_call" },
  { pattern: "water everywhere", severity: "critical", action: "forward_call" },
  { pattern: "smells gas", severity: "critical", action: "forward_call" },
  { pattern: "smells like gas", severity: "critical", action: "forward_call" },
  { pattern: "smell like gas", severity: "critical", action: "forward_call" },
  { pattern: "gas smell", severity: "critical", action: "forward_call" },
  { pattern: "smelling gas", severity: "critical", action: "forward_call" },
  { pattern: "sewage coming", severity: "critical", action: "forward_call" },
  { pattern: "sewage backing", severity: "critical", action: "forward_call" },
  { pattern: "sewer backing", severity: "critical", action: "forward_call" },
  { pattern: "sewage overflowing", severity: "critical", action: "forward_call" },
  { pattern: "sewage shower", severity: "critical", action: "forward_call" },
  { pattern: "water pouring", severity: "critical", action: "forward_call" },
  { pattern: "water gushing", severity: "critical", action: "forward_call" },
  { pattern: "water spraying", severity: "critical", action: "forward_call" },
  { pattern: "water ankles", severity: "critical", action: "forward_call" },
  { pattern: "water knees", severity: "critical", action: "forward_call" },
  { pattern: "ceiling collapsing", severity: "critical", action: "forward_call" },
  { pattern: "ceiling caving", severity: "critical", action: "forward_call" },
  // 2026-10-23, client decision: a burning or electrical smell, smoke or
  // sparking is handled like a gas smell (a water heater with a burning
  // smell near it had been saved as routine). Words match in any order, so
  // "smelling something like a burning smell" and "smells like it's
  // burning" are both covered.
  { pattern: "burning smell", severity: "critical", action: "forward_call" },
  { pattern: "smelling burning", severity: "critical", action: "forward_call" },
  { pattern: "smells burning", severity: "critical", action: "forward_call" },
  { pattern: "burning odor", severity: "critical", action: "forward_call" },
  { pattern: "electrical smell", severity: "critical", action: "forward_call" },
  { pattern: "smoke coming", severity: "critical", action: "forward_call" },
  { pattern: "sparking", severity: "critical", action: "forward_call" },
  // 2026-10-23 live call: a restaurant owner said "water is flowing from the
  // sink ... we are not able to operate", was saved as routine and not put
  // through, while another caller who said "flooding" was. Water actively
  // flowing is the same emergency in other words; a business losing money
  // to the problem is at least urgent.
  { pattern: "water flowing", severity: "critical", action: "forward_call" },
  { pattern: "water is flowing", severity: "critical", action: "forward_call" },
  { pattern: "losing money", severity: "high", action: "priority_notify" },
  { pattern: "out of business", severity: "high", action: "priority_notify" },
  { pattern: "can't operate", severity: "high", action: "priority_notify" },
  { pattern: "not able to operate", severity: "high", action: "priority_notify" },
  { pattern: "no hot water", severity: "high", action: "priority_notify" },
  { pattern: "no water", severity: "high", action: "priority_notify" },
  { pattern: "overflowing toilet", severity: "high", action: "priority_notify" },
  { pattern: "toilet overflowing", severity: "high", action: "priority_notify" },
  { pattern: "water heater leaking", severity: "medium", action: "priority_notify" },
];
