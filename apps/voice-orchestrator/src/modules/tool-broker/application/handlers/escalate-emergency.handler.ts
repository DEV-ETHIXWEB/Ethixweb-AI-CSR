import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { EscalateEmergencyInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

export type EmergencySeverity = "critical" | "high" | "medium";
export type EmergencyAction = "forward_call" | "priority_notify" | "standard_lead";

export interface EscalateEmergencyOutput {
  isEmergency: boolean;
  severity: EmergencySeverity;
  action: EmergencyAction;
  /** The real, currently-on-call phone number to transfer to when `action === "forward_call"` — see core-api's EscalateEmergencyUseCase for how it's resolved. `null` for every other action, or when no on-call target could be resolved. */
  transferDestination: string | null;
}

/**
 * docs/04 §3.8 `escalateEmergency` — delegates to core-api's
 * emergency-rules module (EscalateEmergencyUseCase) via
 * EmergencyRulesToolController, now that it exists (Phase 7). Closes the
 * Technical Debt item this handler's own comment previously flagged: the
 * fail-safe-toward-escalation fallback (docs/07 §5.2) now lives correctly
 * INSIDE EscalateEmergencyUseCase itself (still applied on any failure —
 * this handler no longer needs its own copy of that logic).
 */
@Injectable()
export class EscalateEmergencyHandler implements ToolHandler<
  EscalateEmergencyInput,
  EscalateEmergencyOutput
> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(
    input: EscalateEmergencyInput,
    _context: ToolHandlerContext,
  ): Promise<EscalateEmergencyOutput> {
    return this.coreApiClient.post<EscalateEmergencyOutput>("/internal/emergency-rules/escalate", {
      businessId: input.business_id,
      callId: input.call_id,
      description: input.description,
      detectedKeywords: input.detected_keywords,
    });
  }
}
