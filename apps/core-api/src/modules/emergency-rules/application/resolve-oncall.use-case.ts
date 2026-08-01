import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { OnCallStrategy } from "../domain/oncall.entity";
import { ONCALL_REPOSITORY, type OnCallRepository } from "../domain/ports/oncall-repository.port";

export interface ResolveOnCallResult {
  /**
   * Phone numbers to ring, in the order (or simultaneity — see `strategy`)
   * the caller (the Voice Runtime's SIP-transfer logic, per docs/02 §4)
   * should try them. Empty means "no reachable on-call target" — the
   * caller's own responsibility from there is docs/07 §5.3's "all
   * exhausted -> voicemail + highest-priority notification fan-out,"
   * which belongs to the telephony/notification layers, not this use-case.
   */
  targets: string[];
  strategy: OnCallStrategy | null;
}

/**
 * docs/07 §5.3's on-call routing resolver. Assumes ONE active rotation per
 * business (the first `listRotationsByBusiness` row) — docs don't describe
 * a business running multiple simultaneous rotations, so this is a
 * reasonable reading, not a verbatim requirement; flagged the same way
 * lead-lifecycle.ts flags its own inferences.
 *
 * Only `OnCallShift.phoneOverride` is ever a reachable phone number here —
 * `User` (packages/database schema) has no phone column at all, so a
 * shift with no override has no number this resolver can produce. A real
 * gap, not an oversight: flagged loudly rather than silently returning an
 * empty target list that looks identical to "nobody's on call."
 */
@Injectable()
export class ResolveOnCallUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(ONCALL_REPOSITORY) private readonly onCallRepository: OnCallRepository,
  ) {}

  async execute(
    tenantId: string,
    businessId: string,
    at: Date = new Date(),
  ): Promise<ResolveOnCallResult> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    return this.tenantContext.run(tenantId, async (db) => {
      const rotations = await this.onCallRepository.listRotationsByBusiness(
        db,
        tenantId,
        businessId,
      );
      const rotation = rotations[0];
      if (!rotation) {
        return { targets: [], strategy: null };
      }
      const strategy = rotation.strategy as OnCallStrategy;

      const activeShifts = await this.onCallRepository.findActiveShifts(
        db,
        tenantId,
        rotation.id,
        at,
      );
      const activeTargets = activeShifts
        .map((shift) => shift.phoneOverride)
        .filter((phone): phone is string => phone !== null);
      if (activeTargets.length > 0) {
        return { targets: activeTargets, strategy };
      }

      // docs/07 §5.3's "no fallback shift" branch — try the next upcoming
      // shift's number as a best-effort escalation target rather than
      // returning nothing; still falls through to empty if that shift
      // also has no phoneOverride.
      const upcoming = await this.onCallRepository.findUpcomingShift(db, tenantId, rotation.id, at);
      return { targets: upcoming?.phoneOverride ? [upcoming.phoneOverride] : [], strategy };
    });
  }
}
