import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { ResolveOnCallUseCase } from "./resolve-oncall.use-case";

export type TransferToHumanReason =
  "caller_requested" | "cannot_help" | "caller_frustrated" | "business_workflow";

export interface TransferToHumanCommand {
  tenantId: string;
  businessId: string;
  callId: string;
  reason: TransferToHumanReason;
  /** Grace's own one-line handoff summary — name/problem/address/whatever is known, for the human who picks up. Never spoken to the caller; carried through purely for context. */
  summary: string;
}

export interface TransferToHumanResult {
  /**
   * The real, currently-on-call phone number to transfer to — resolved via
   * the SAME `ResolveOnCallUseCase` (docs/07 §5.3) escalateEmergency's own
   * forward_call action already uses. Deliberately reused rather than a
   * second "who answers the phone" concept: for a business this size, the
   * on-call target IS the person who should take a non-emergency handoff
   * too, and a second config surface would be a real feature nobody asked
   * for. `null` when no on-call target could be resolved (no rotation
   * configured, no active shift, no reachable phoneOverride, or the lookup
   * itself failed) — the caller (voice-runtime's CallSessionOrchestrator)
   * already has its own static fallback chain for exactly this case, the
   * same one escalateEmergency's own resolution failure falls back to.
   */
  transferDestination: string | null;
}

/**
 * docs/04 §3.9-equivalent `transferToHuman` — the non-emergency counterpart
 * to `EscalateEmergencyUseCase`. Built because a full-stack trace of "what
 * actually happens when a caller asks for a human" found nothing: the
 * prompt was told to answer honestly and never falsely promise a transfer
 * (v8), but there was no real transfer TOOL behind an honest "I can't
 * connect you" for anything other than an emergency — `forward_call` was
 * escalateEmergency-only. A caller who is frustrated, has a request Grace
 * genuinely can't help with, or just wants a person had no path off the AI
 * except hanging up.
 *
 * Kept deliberately separate from EscalateEmergencyUseCase rather than
 * merged into it: emergency severity/priority must never be influenced by,
 * or confusable with, an ordinary "please get me a person" request — the
 * prompt-level priority order (emergency always wins) depends on these
 * staying two distinct signals all the way through the stack, not just in
 * the model's own reasoning.
 */
@Injectable()
export class TransferToHumanUseCase {
  constructor(
    private readonly resolveOnCallUseCase: ResolveOnCallUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: TransferToHumanCommand): Promise<TransferToHumanResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    try {
      const { targets } = await this.resolveOnCallUseCase.execute(
        command.tenantId,
        command.businessId,
      );
      if (targets.length === 0) {
        this.logger.warn(
          "transferToHuman requested but no on-call target could be resolved — falling back to the runtime's static transfer number",
          {
            tenantId: command.tenantId,
            businessId: command.businessId,
            callId: command.callId,
            reason: command.reason,
          },
        );
        return { transferDestination: null };
      }
      return { transferDestination: targets[0] as string };
    } catch (error) {
      this.logger.warn(
        "on-call resolution failed while handling a transferToHuman request — falling back to the runtime's static transfer number",
        {
          tenantId: command.tenantId,
          businessId: command.businessId,
          callId: command.callId,
          reason: error instanceof Error ? error.message : String(error),
        },
      );
      return { transferDestination: null };
    }
  }
}
