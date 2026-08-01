import { Injectable } from "@nestjs/common";
import type { NotificationChannelSender } from "../domain/ports/notification-channel-sender.port";

@Injectable()
export class ChannelSenderRegistry {
  private readonly senders = new Map<string, NotificationChannelSender>();

  register(sender: NotificationChannelSender): void {
    this.senders.set(sender.channelType, sender);
  }

  get(channelType: string): NotificationChannelSender | undefined {
    return this.senders.get(channelType);
  }
}
