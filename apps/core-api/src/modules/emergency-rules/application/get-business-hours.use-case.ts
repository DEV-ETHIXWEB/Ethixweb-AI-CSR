import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { BusinessHour, BusinessHoursResult } from "../domain/business-hour.entity";
import {
  BUSINESS_HOUR_REPOSITORY,
  type BusinessHourRepository,
} from "../domain/ports/business-hour-repository.port";

const DAYS_TO_SEARCH = 7;

/**
 * docs/04-ai-tool-architecture.md §3.6 `getBusinessHours`. On any failure
 * (including "no hours configured at all"), falls back to the tool's own
 * documented default — "treat as after-hours... never falsely tells a
 * caller the office is open."
 *
 * `isHoliday` is always `false` here — `BusinessHour.holidayCalendarRef`
 * (docs/06) points at a holiday calendar that has no modeled data source
 * anywhere in this schema (no `HolidayCalendar` table exists); returning
 * a fabricated holiday determination would be worse than honestly
 * reporting "not evaluated," so this is left for whenever that data
 * source is actually built, not guessed at here.
 */
@Injectable()
export class GetBusinessHoursUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(BUSINESS_HOUR_REPOSITORY)
    private readonly businessHourRepository: BusinessHourRepository,
  ) {}

  async execute(
    tenantId: string,
    businessId: string,
    at: Date = new Date(),
  ): Promise<BusinessHoursResult> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    try {
      const rows = await this.tenantContext.run(tenantId, (db) =>
        this.businessHourRepository.listByBusiness(db, tenantId, businessId),
      );
      if (rows.length === 0) {
        return { isOpen: false, opensAt: null, isHoliday: false };
      }

      const todayRow = rows.find((row) => row.dayOfWeek === at.getDay());
      if (todayRow && isWithinTimeOfDay(at, todayRow.openTime, todayRow.closeTime)) {
        return { isOpen: true, opensAt: null, isHoliday: false };
      }

      return { isOpen: false, opensAt: findNextOpenTime(rows, at), isHoliday: false };
    } catch {
      return { isOpen: false, opensAt: null, isHoliday: false };
    }
  }
}

function isWithinTimeOfDay(at: Date, openTime: Date, closeTime: Date): boolean {
  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  const openMinutes = openTime.getUTCHours() * 60 + openTime.getUTCMinutes();
  const closeMinutes = closeTime.getUTCHours() * 60 + closeTime.getUTCMinutes();
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

/** Walks forward day-by-day (bounded at one week) to find the next configured opening — an ISO timestamp for the caller (LLM prompt assembly) to phrase naturally, not a pre-formatted string. */
function findNextOpenTime(rows: BusinessHour[], at: Date): string | null {
  for (let offset = 0; offset <= DAYS_TO_SEARCH; offset++) {
    const candidateDate = new Date(at);
    candidateDate.setDate(candidateDate.getDate() + offset);
    const dayOfWeek = candidateDate.getDay();
    const row = rows.find((r) => r.dayOfWeek === dayOfWeek);
    if (!row) {
      continue;
    }
    const candidateOpen = new Date(candidateDate);
    candidateOpen.setHours(row.openTime.getUTCHours(), row.openTime.getUTCMinutes(), 0, 0);
    if (candidateOpen > at) {
      return candidateOpen.toISOString();
    }
  }
  return null;
}
