import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { GetBusinessUseCase } from "../../tenants/application/get-business.use-case";
import type { BusinessHour, BusinessHoursResult } from "../domain/business-hour.entity";
import {
  BUSINESS_HOUR_REPOSITORY,
  type BusinessHourRepository,
} from "../domain/ports/business-hour-repository.port";

const DAYS_TO_SEARCH = 7;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * docs/04-ai-tool-architecture.md §3.6 `getBusinessHours`. On any failure
 * (including "no hours configured at all"), falls back to the tool's own
 * documented default — "treat as after-hours... never falsely tells a
 * caller the office is open."
 *
 * TIMEZONE CORRECTNESS: found live, not hypothetical — this previously
 * compared `at.getHours()` (the SERVER PROCESS's own local system
 * timezone) directly against `openTime.getUTCHours()`
 * (`BusinessHour.openTime`/`closeTime` are pure wall-clock values with NO
 * timezone attached — Postgres `TIME` has none, see `BusinessHour`'s own
 * comment). Those two things have nothing to do with each other unless
 * the server happens to run in the exact timezone the wall-clock hours
 * were meant to represent, which is never guaranteed and wasn't true even
 * in local dev (server process in IST, business configured for
 * America/Chicago) — reproduced live: a business with a real 8am-6pm
 * Saturday row, called at 9:29am its own local time (should be open),
 * reported `isOpen: false` and predicted the next opening a full week
 * away. Fixed by resolving the business's own `timezone` (`Business`
 * entity, already a real column, never read here before) and converting
 * `at` into that timezone's wall-clock day/time via `Intl.DateTimeFormat`
 * — the correct, DST-aware, no-new-dependency primitive for "what time is
 * it right now in zone X," unlike `Date.prototype.getHours()`, which has
 * no concept of any timezone but the process's own.
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
    private readonly getBusinessUseCase: GetBusinessUseCase,
  ) {}

  async execute(
    tenantId: string,
    businessId: string,
    at: Date = new Date(),
  ): Promise<BusinessHoursResult> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    try {
      const [rows, business] = await Promise.all([
        this.tenantContext.run(tenantId, (db) =>
          this.businessHourRepository.listByBusiness(db, tenantId, businessId),
        ),
        this.getBusinessUseCase.execute(tenantId, businessId),
      ]);
      if (rows.length === 0) {
        return { isOpen: false, opensAt: null, isHoliday: false };
      }

      const timezone = business.timezone;
      const { dayOfWeek, minutesSinceMidnight } = zonedDayAndMinutes(at, timezone);
      const todayRow = rows.find((row) => row.dayOfWeek === dayOfWeek);
      if (
        todayRow &&
        isWithinMinutesOfDay(minutesSinceMidnight, todayRow.openTime, todayRow.closeTime)
      ) {
        return { isOpen: true, opensAt: null, isHoliday: false };
      }

      return { isOpen: false, opensAt: findNextOpenTime(rows, at, timezone), isHoliday: false };
    } catch {
      return { isOpen: false, opensAt: null, isHoliday: false };
    }
  }
}

function isWithinMinutesOfDay(nowMinutes: number, openTime: Date, closeTime: Date): boolean {
  const openMinutes = openTime.getUTCHours() * 60 + openTime.getUTCMinutes();
  const closeMinutes = closeTime.getUTCHours() * 60 + closeTime.getUTCMinutes();
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes;
}

/**
 * The current wall-clock day-of-week (0=Sunday..6=Saturday, matching
 * `BusinessHour.dayOfWeek`/JS `Date.getDay()`) and minutes-since-midnight
 * for `at` AS OBSERVED IN `timezone` — exact for any instant, DST
 * included, since `Intl.DateTimeFormat` resolves each instant's own civil
 * time in the target zone natively rather than through any offset
 * arithmetic this code would have to get right itself.
 */
function zonedDayAndMinutes(
  at: Date,
  timezone: string,
): { dayOfWeek: number; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return { dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0, minutesSinceMidnight: hour * 60 + minute };
}

/**
 * Walks forward day-by-day (bounded at one week) to find the next
 * configured opening, expressed as a real UTC instant. Computed as real
 * elapsed milliseconds relative to `at` — `offset` whole days plus the
 * (local) minutes-of-day delta between `at` and the candidate row's open
 * time — rather than reconstructing a UTC instant from calendar fields,
 * which would need this code to get `timezone`'s UTC offset exactly right
 * for a possibly-future date. Exact for the overwhelming majority of
 * cases; the one honest residual gap is a candidate day landing on the
 * OTHER side of a DST transition from `at` itself, where "24 real hours"
 * and "one local calendar day" briefly diverge by the DST delta
 * (typically one hour, twice a year). Accepted here because this value is
 * ONLY ever used for "we'll be open at X" phrasing (never for the
 * `isOpen` determination itself, which re-derives its own local time per
 * instant via `zonedDayAndMinutes` and has no such gap) — a rare, narrow,
 * and honestly-documented limitation on a display field, rather than
 * pulling in a full timezone-database library for it.
 */
function findNextOpenTime(rows: BusinessHour[], at: Date, timezone: string): string | null {
  const today = zonedDayAndMinutes(at, timezone);

  for (let offset = 0; offset <= DAYS_TO_SEARCH; offset++) {
    const candidateDayOfWeek = (today.dayOfWeek + offset) % 7;
    const row = rows.find((r) => r.dayOfWeek === candidateDayOfWeek);
    if (!row) {
      continue;
    }
    const openMinutes = row.openTime.getUTCHours() * 60 + row.openTime.getUTCMinutes();
    const candidateMs =
      at.getTime() +
      offset * 24 * 60 * 60_000 +
      (openMinutes - today.minutesSinceMidnight) * 60_000;
    if (candidateMs > at.getTime()) {
      return new Date(candidateMs).toISOString();
    }
  }
  return null;
}
