/**
 * docs/06-database-schema.md CRM_SYNC_LOG. Independent of the tool broker's
 * own `tool_calls` audit log (docs/13 crm-integration §5) — this one tracks
 * CRM-side sync state specifically (one row per adapter operation attempt),
 * the source of truth a future retry/DLQ worker would read from.
 */
export interface CrmSyncLog {
  id: string;
  tenantId: string;
  integrationId: string;
  operation: string;
  entityType: string;
  entityId: string | null;
  status: string;
  idempotencyKey: string;
  requestPayload: unknown;
  responsePayload: unknown;
  createdAt: Date;
}

export const CRM_SYNC_STATUS = {
  SUCCESS: "success",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
} as const;
