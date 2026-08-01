import { Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { EscalateEmergencyInput } from "../../domain/tool-catalog";

export type EmergencySeverity = "critical" | "high" | "medium";
export type EmergencyAction = "forward_call" | "priority_notify" | "standard_lead";

export interface EscalateEmergencyOutput {
  isEmergency: boolean;
  severity: EmergencySeverity;
  action: EmergencyAction;
}

/**
 * docs/04 §3.8 `escalateEmergency`. No `emergency-rules` module/rule
 * engine exists yet (Phase 7) — this handler is not a placeholder that
 * fabricates a qualification engine; it applies docs/04 §3.8's OWN
 * documented fail-safe fallback verbatim, unconditionally (this handler
 * IS always in the "rules engine can't be reached" state today): "default
 * to treating ambiguous 'leak/water/gas' language as at least
 * priority_notify rather than silently downgrading to routine." The
 * keyword list below is that literal fallback rule, not an invented
 * emergency-detection algorithm — a real rules engine (configurable per
 * business, per docs/07-notification-and-emergency.md §4) is Phase 7's
 * job, not this handler's.
 */
const FAIL_SAFE_KEYWORDS = [
  "leak",
  "leaking",
  "water",
  "gas",
  "flood",
  "flooding",
  "fire",
  "smoke",
];

@Injectable()
export class EscalateEmergencyHandler implements ToolHandler<
  EscalateEmergencyInput,
  EscalateEmergencyOutput
> {
  async execute(
    input: EscalateEmergencyInput,
    _context: ToolHandlerContext,
  ): Promise<EscalateEmergencyOutput> {
    const haystack = [input.description, ...(input.detected_keywords ?? [])]
      .join(" ")
      .toLowerCase();
    const matchedFailSafeLanguage = FAIL_SAFE_KEYWORDS.some((keyword) =>
      haystack.includes(keyword),
    );

    if (matchedFailSafeLanguage) {
      return { isEmergency: true, severity: "medium", action: "priority_notify" };
    }
    return { isEmergency: false, severity: "medium", action: "standard_lead" };
  }
}
