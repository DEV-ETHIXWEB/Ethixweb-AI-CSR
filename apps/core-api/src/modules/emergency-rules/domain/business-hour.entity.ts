/** docs/06-database-schema.md BUSINESS_HOURS. `dayOfWeek`: 0=Sunday..6=Saturday, matching JS `Date.getDay()`. */
export interface BusinessHour {
  id: string;
  tenantId: string;
  businessId: string;
  dayOfWeek: number;
  /** Time-of-day only (no date component) — stored as a full Date by Prisma's `@db.Time`, only the HH:mm:ss portion is meaningful. */
  openTime: Date;
  closeTime: Date;
  holidayCalendarRef: string | null;
}

export interface BusinessHoursResult {
  isOpen: boolean;
  opensAt: string | null;
  isHoliday: boolean;
}
