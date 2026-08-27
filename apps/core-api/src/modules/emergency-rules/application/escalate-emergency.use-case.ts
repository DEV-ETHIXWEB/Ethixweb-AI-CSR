import { Inject, Injectable } from "@nestjs/common";
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
   * Phone numbers to transfer to, in ring order — populated only when
   * `action === "forward_call"` (empty otherwise). This is what closes the
   * loop on `ResolveOnCallUseCase`'s own documented purpose ("the Voice
   * Runtime's SIP-transfer logic") — previously computed nowhere, so a
   * `forward_call` action had no destination for the runtime to act on.
   */
  transferTargets: string[];
}

/**
 * docs/07 §5.1's rule-matching engine: keyword/pattern match against the
 * business's own `EmergencyRule` rows, falling back to
 * `DEFAULT_EMERGENCY_KEYWORDS` only when the business hasn't configured
 * any of its own — never a hardcoded decision the business can't override.
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
    private readonly resolveOnCall: ResolveOnCallUseCase,
  ) {}

  async execute(command: EscalateEmergencyCommand): Promise<EscalateEmergencyResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const haystack = [command.description, ...(command.detectedKeywords ?? [])]
      .join(" ")
      .toLowerCase();

    const decision = await this.decide(command, haystack);
    if (decision.action !== "forward_call") {
      return { ...decision, transferTargets: [] };
    }

    const transferTargets = await this.resolveTransferTargets(
      command.tenantId,
      command.businessId,
    );
    return { ...decision, transferTargets };
  }

  private async decide(
    command: EscalateEmergencyCommand,
    haystack: string,
  ): Promise<Omit<EscalateEmergencyResult, "transferTargets">> {
    try {
      const configuredRules = await this.tenantContext.run(command.tenantId, (db) =>
        this.emergencyRuleRepository.listActiveByBusiness(db, command.tenantId, command.businessId),
      );

      if (configuredRules.length > 0) {
        const matched = configuredRules.find((rule) =>
          haystack.includes(rule.keywordOrPattern.toLowerCase()),
        );
        if (matched) {
          return {
            isEmergency: true,
            severity: matched.severity as EmergencySeverity,
            action: matched.escalationAction as EmergencyAction,
            matchedPattern: matched.keywordOrPattern,
          };
        }
        return {
          isEmergency: false,
          severity: "medium",
          action: "standard_lead",
          matchedPattern: null,
        };
      }

      const defaultMatch = DEFAULT_EMERGENCY_KEYWORDS.find((entry) =>
        haystack.includes(entry.pattern),
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

  /**
   * A failure here must not crash the escalation itself — an empty target
   * list is `ResolveOnCallUseCase`'s own documented "nobody reachable"
   * signal, which the runtime/notification fallback already handles
   * (docs/07 §5.3's "all exhausted -> voicemail + highest-priority
   * notification fan-out").
   */
  private async resolveTransferTargets(tenantId: string, businessId: string): Promise<string[]> {
    try {
      const { targets } = await this.resolveOnCall.execute(tenantId, businessId);
      return targets;
    } catch {
      return [];
    }
  }
}
