/**
 * DI token for shared-kernel's `IdempotencyStore` port — that package's own
 * doc comment names this as "used by the tool broker and CRM/notification
 * writes," so this token lives at the app-shared level (not inside the crm
 * module) even though the crm module is its first real consumer here.
 */
export const IDEMPOTENCY_STORE = Symbol("IDEMPOTENCY_STORE");
