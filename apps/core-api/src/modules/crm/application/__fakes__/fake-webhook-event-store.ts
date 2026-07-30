import type { Db, WebhookEventStore } from "../../../../shared/webhooks/webhook-event-store";

export class FakeWebhookEventStore implements WebhookEventStore {
  private readonly seen = new Set<string>();

  async recordIfNew(
    _db: Db,
    provider: string,
    providerEventId: string,
    _payload: unknown,
    _tenantId?: string,
  ): Promise<boolean> {
    const key = `${provider}:${providerEventId}`;
    if (this.seen.has(key)) {
      return false;
    }
    this.seen.add(key);
    return true;
  }
}
