/** docs/06-database-schema.md ONCALL_ROTATIONS / ONCALL_SHIFTS. */
export const ONCALL_STRATEGIES = ["round_robin", "priority_list", "simultaneous_ring"] as const;
export type OnCallStrategy = (typeof ONCALL_STRATEGIES)[number];

export interface OnCallRotation {
  id: string;
  tenantId: string;
  businessId: string;
  name: string;
  strategy: string;
}

export interface OnCallShift {
  id: string;
  tenantId: string;
  rotationId: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  /** Overrides the assigned user's own contact number for this shift — see PrismaOnCallRepository's own comment on why this is the ONLY reachable phone number in this build (User has no phone column yet). */
  phoneOverride: string | null;
}

export interface ResolvedOnCallTarget {
  shift: OnCallShift;
  /** Null if neither `phoneOverride` nor a resolvable user phone exists — caller must fall through to the next shift/rotation member. */
  phone: string | null;
}
