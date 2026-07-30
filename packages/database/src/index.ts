export { PrismaClient, Prisma } from "@prisma/client";
// Re-exported so consuming apps (apps/core-api) don't need their own direct
// dependency on the Postgres driver adapter — @ethixweb/database is the one
// place that owns "how do we actually connect to Postgres" (Prisma 7's
// driver-adapter runtime requirement, see prisma/schema.prisma's top comment).
export { PrismaPg } from "@prisma/adapter-pg";
export type {
  Tenant,
  Business,
  User,
  ApiKey,
  Integration,
  AgentConfig,
  EmergencyRule,
  BusinessHour,
  OnCallRotation,
  OnCallShift,
  NotificationChannel,
  Notification,
  Customer,
  Call,
  VoiceSession,
  Transcript,
  ToolCall,
  Lead,
  LeadClaim,
  CrmSyncLog,
  AuditLog,
  WebhookSubscription,
  WebhookDelivery,
  WebhookEvent,
  OutboxEvent,
  TenantStatus,
  UserRole,
  LeadStatus,
} from "@prisma/client";
