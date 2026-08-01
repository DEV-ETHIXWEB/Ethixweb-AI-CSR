import type { NotificationDestination } from "../notification.entity";
import type { NotificationPayload } from "../notification-payload";

export interface SendResult {
  success: boolean;
  providerMessageId?: string | undefined;
  error?: string | undefined;
}

export interface NotificationChannelSender {
  readonly channelType: string;
  send(destination: NotificationDestination, payload: NotificationPayload): Promise<SendResult>;
}
