/** Mirrors apps/core-api/src/modules/notifications/interfaces/dto/notification-response.dto.ts exactly. */

export interface NotificationSummary {
  id: string;
  leadId: string;
  channelType: string;
  status: string;
  attemptCount: number;
  sentAt: string | null;
  createdAt: string;
}

export interface PaginatedNotifications {
  items: NotificationSummary[];
  total: number;
}

export interface RequeueOutcome {
  channelType: string;
  success: boolean;
  error: string | null;
}
