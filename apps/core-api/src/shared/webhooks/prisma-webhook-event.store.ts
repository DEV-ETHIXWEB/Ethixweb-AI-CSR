import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import type { Db, WebhookEventStore } from "./webhook-event-store";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class PrismaWebhookEventStore implements WebhookEventStore {
  async recordIfNew(
    db: Db,
    provider: string,
    providerEventId: string,
    payload: unknown,
    tenantId?: string,
  ): Promise<boolean> {
    try {
      await db.webhookEvent.create({
        data: {
          provider,
          providerEventId,
          payload: payload as Prisma.InputJsonValue,
          tenantId: tenantId ?? null,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return false;
      }
      throw error;
    }
  }
}
