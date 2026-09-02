import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  DEFAULT_EMERGENCY_KEYWORDS,
  type EmergencyAction,
  type EmergencySeverity,
} from "../domain/emergency-rule.entity";
import {
  EMERGENCY_RULE_REPOSITORY,
  type EmergencyRuleRepository,
} from "../domain/ports/emergency-rule-repository.port";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";

export interface EscalateEmergencyCommand {
  tenantId: string;
  businessId: string;
  callId: string;
  description: string;
  detectedKeywords?: string[] | undefined;
}

export interface EscalateEmergencyResult {
  isEmergency: boolean;
  severity: EmergencySeverity;
  action: EmergencyAction;
  matchedPattern: string | null;
  /**
   * The real, currently-on-call phone number to transfer to, when
   * `action === "forward_call"` — resolved via ResolveOnCallUseCase
   * (docs/07 §5.3), which existed, was fully built and tested, but was
   * never actually called from anywhere in the codebase before this
   * (found during a final production-readiness audit tracing the
   * complete "does a real human get contacted" path end to end).
   * `null` for every other action, or when forward_call is decided but no
   * on-call target could be resolved (no rotation configured, no active
   * shift, no reachable phoneOverride, or the lookup itself failed) — the
   * caller (voice-runtime's CallSessionOrchestrator) falls back to its
   * own static EMERGENCY_TRANSFER_NUMBER/HUMAN_FALLBACK_NUMBER chain in
   * that case, so a resolution failure here degrades, never blocks, the
   * transfer.
   */
  transferDestination: string | null;
}

/**
 * docs/07 §5.1's rule-matching engine: keyword/pattern match against the
 * business's own `EmergencyRule` rows FIRST — a configured rule's severity
 * and action always win when it matches, so a business can still fully
 * customize its own emergency vocabulary.
 *
 * `DEFAULT_EMERGENCY_KEYWORDS` is then ALWAYS checked too, as a floor, not
 * only when a business has configured zero rules of its own. Found live,
 * a real production risk: the previous version returned "not an
 * emergency" the instant a business had ANY configured rules and none of
 * them matched — meaning a business with even one narrow custom rule
 * (e.g. just "burst pipe") silently lost every other default pattern
 * (gas leak, flooding, sewage backup, no hot water, ...) the moment that
 * one rule was added, with nothing anywhere surfacing that the safety net
 * had quietly disappeared. docs/07 §5.2's own fail-safe principle — "the
 * system defaults toward escalation, not away from it" — applies here
 * exactly as much as it does to the catch-all below: a business's own
 * rules should be able to ADD coverage or override severity/action for
 * patterns they've thought about, never silently REMOVE the platform's
 * baseline coverage for patterns they haven't.
 *
 * Matching is word-set-based, not a raw substring test — also found live:
 * a caller saying "a pipe burst in my basement" never matched a
 * configured/default "burst pipe" pattern, because a plain substring
 * check is sensitive to word order. `matchesPattern` instead checks that
 * every word of the pattern appears somewhere in the caller's own words,
 * in any order — which also fixes a real false-positive the substring
 * version had (a pattern like "gas" matching inside an unrelated word
 * like "gasket").
 *
 * docs/07 §5.2's fail-safe default is structural here, not an afterthought:
 * any unexpected error inside the matching step itself is caught and
 * mapped to the SAME conservative result an ambiguous match would produce
 * (`priority_notify`, not silently downgraded to routine) — "the system
 * defaults toward escalation, not away from it."
 */
@Injectable()
export class EscalateEmergencyUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(EMERGENCY_RULE_REPOSITORY)
    private readonly emergencyRuleRepository: EmergencyRuleRepository,
    private readonly resolveOnCallUseCase: ResolveOnCallUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: EscalateEmergencyCommand): Promise<EscalateEmergencyResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const classification = await this.classify(command);
    if (classification.action !== "forward_call") {
      return { ...classification, transferDestination: null };
    }

    const transferDestination = await this.resolveTransferDestination(command);
    return { ...classification, transferDestination };
  }

  private async classify(
    command: EscalateEmergencyCommand,
  ): Promise<Omit<EscalateEmergencyResult, "transferDestination">> {
    const haystack = [command.description, ...(command.detectedKeywords ?? [])]
      .join(" ")
      .toLowerCase();

    try {
      const configuredRules = await this.tenantContext.run(command.tenantId, (db) =>
        this.emergencyRuleRepository.listActiveByBusiness(db, command.tenantId, command.businessId),
      );

      const configuredMatch = configuredRules.find((rule) =>
        matchesPattern(haystack, rule.keywordOrPattern),
      );
      if (configuredMatch) {
        return {
          isEmergency: true,
          severity: configuredMatch.severity as EmergencySeverity,
          action: configuredMatch.escalationAction as EmergencyAction,
          matchedPattern: configuredMatch.keywordOrPattern,
        };
      }

      const defaultMatch = DEFAULT_EMERGENCY_KEYWORDS.find((entry) =>
        matchesPattern(haystack, entry.pattern),
      );
      if (defaultMatch) {
        return {
          isEmergency: true,
          severity: defaultMatch.severity,
          action: defaultMatch.action,
          matchedPattern: defaultMatch.pattern,
        };
      }
      return {
        isEmergency: false,
        severity: "medium",
        action: "standard_lead",
        matchedPattern: null,
      };
    } catch {
      // docs/07 §5.2, verbatim: the rules engine being unreachable fails
      // SAFE toward escalation, never silently downgraded — a false
      // positive costs a phone call, a false negative costs property
      // damage or a safety incident.
      return {
        isEmergency: true,
        severity: "medium",
        action: "priority_notify",
        matchedPattern: null,
      };
    }
  }

  /** Best-effort — never throws, never blocks the forward_call decision itself. A failed/empty resolution returns null; the caller (voice-runtime) already has its own static fallback destination for exactly this case. */
  private async resolveTransferDestination(
    command: EscalateEmergencyCommand,
  ): Promise<string | null> {
    try {
      const { targets } = await this.resolveOnCallUseCase.execute(
        command.tenantId,
        command.businessId,
      );
      if (targets.length === 0) {
        this.logger.warn(
          "escalateEmergency decided forward_call but no on-call target could be resolved — falling back to the runtime's static transfer number",
          { tenantId: command.tenantId, businessId: command.businessId, callId: command.callId },
        );
        return null;
      }
      return targets[0] as string;
    } catch (error) {
      this.logger.warn(
        "on-call resolution failed while handling a forward_call escalation — falling back to the runtime's static transfer number",
        {
          tenantId: command.tenantId,
          businessId: command.businessId,
          callId: command.callId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      return null;
    }
  }
}

/**
 * Word-set containment, not a substring test — see this class's own
 * comment for why. Splits `pattern` into words and requires every one of
 * them to appear somewhere in `haystack`'s own words, in any order, so
 * "burst pipe" matches a caller saying "a pipe burst in my basement" just
 * as readily as one saying "my burst pipe is flooding the kitchen".
 * Whole-word matching (not `String.includes`) also closes a real
 * false-positive the old substring check had — a short pattern like "gas"
 * no longer matches inside an unrelated word like "gasket".
 */
function matchesPattern(haystack: string, pattern: string): boolean {
  const patternWords = pattern.toLowerCase().match(/\w+/g) ?? [];
  if (patternWords.length === 0) {
    return false;
  }
  const haystackWords = new Set(haystack.toLowerCase().match(/\w+/g) ?? []);
  return patternWords.every((word) => haystackWords.has(word));
}
