/**
 * The admission-control seam: reserve capacity before a conversation is
 * created, release it when the call ends. Deliberately separate from
 * `ConversationRepository` (conversation module) — admission is a
 * PRE-conversation decision (see StartConversationUseCase's own comment on
 * why the gate sits before `POST /internal/calls`), and this port has no
 * concept of conversation state at all, only "is there room."
 */
export interface CallAdmissionPort {
  /**
   * Atomically reserves one slot against both the tenant and global
   * ceilings, or throws `CapacityExceededError` if either is full.
   * `reservationId` must be released exactly once via `release()` — callers
   * are responsible for calling `release()` in every exit path (including
   * best-effort call-end, matching the existing best-effort side-effect
   * pattern in EndConversationUseCase).
   */
  reserve(
    tenantId: string,
    businessId: string,
    limits: {
      maxTenantConcurrentCalls: number;
      maxGlobalConcurrentCalls: number;
      /**
       * Fraction (0-1) of maxTenantConcurrentCalls a NORMAL call may not
       * consume, leaving headroom an emergency-priority reservation can
       * still claim. See docs/36 §5's honest limits: this is the only form
       * of "emergency priority" available at admission time, since no
       * signal exists before a conversation/turn to know a call IS an
       * emergency (that's discovered mid-conversation via the
       * escalateEmergency tool, which requires a conversation to already
       * exist). This does not prioritize a SPECIFIC call — it reserves a
       * slice of capacity so an emergency-priority reservation is more
       * likely to find room, nothing stronger is honestly claimable today.
       */
      emergencyHeadroomRatio: number;
      /** True only when the caller (Voice Runtime) explicitly flags this admission attempt as emergency-priority — see StartConversationDto's own comment on how thin this signal is expected to be in practice. */
      isEmergencyPriority: boolean;
    },
  ): Promise<{ reservationId: string }>;

  release(tenantId: string, reservationId: string): Promise<void>;

  /** Current in-flight counts — the read side of the same counters, used for observability (docs/36 §11's `active_calls`/`per_tenant_active_calls`). */
  getActiveCounts(tenantId: string): Promise<{ tenantActive: number; globalActive: number }>;
}

export const CALL_ADMISSION_PORT = Symbol("CALL_ADMISSION_PORT");
