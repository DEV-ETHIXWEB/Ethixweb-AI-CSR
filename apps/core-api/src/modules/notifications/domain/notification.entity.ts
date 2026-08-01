/** docs/06-database-schema.md NOTIFICATION_CHANNELS / NOTIFICATIONS, docs/07 §2-3. */
export const NOTIFICATION_CHANNEL_TYPES = ["sms", "email", "slack", "teams", "webhook"] as const;
export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

/** `dead_letter`: retry budget exhausted (see SendLeadNotificationUseCase) — visible via GET /notifications/dead-letter and redrivable via POST /notifications/:id/requeue, the actual Dead Letter Queue mechanics rather than an in-memory queue this Postgres-backed schema has no table for. */
export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "dead_letter"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * `destination`'s shape is channel-type-dependent — stored as JSON per the
 * schema (docs/06) since a single relational shape can't cleanly cover
 * SMS/email/Slack/Teams/webhook destinations. `userId` is an OPTIONAL
 * extra field this build adds meaning to (not a schema change — `destination`
 * is already unstructured JSON): when present on an `sms` channel, it's who
 * a "Reply CLAIM" from that channel's phone number claims the lead as (see
 * HandleSmsClaimReplyUseCase's own comment on why this is necessary — `User`
 * has no phone column, so a channel-configured userId is the only way to
 * resolve "whose reply is this" for the claim flow).
 */
export interface NotificationDestination {
  phone?: string;
  userId?: string;
  email?: string;
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface NotificationChannel {
  id: string;
  tenantId: string;
  businessId: string;
  channelType: string;
  destination: NotificationDestination;
  isActive: boolean;
  priorityOrder: number;
}

export interface Notification {
  id: string;
  tenantId: string;
  leadId: string;
  channelType: string;
  destination: string;
  status: string;
  dedupKey: string;
  attemptCount: number;
  sentAt: Date | null;
  createdAt: Date;
}
