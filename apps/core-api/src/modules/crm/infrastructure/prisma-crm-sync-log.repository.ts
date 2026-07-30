import { Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import type { CrmSyncLog } from "../domain/crm-sync-log.entity";
import type {
  CrmSyncLogRepository,
  Db,
  RecordCrmSyncInput,
} from "../domain/ports/crm-sync-log-repository.port";

@Injectable()
export class PrismaCrmSyncLogRepository implements CrmSyncLogRepository {
  async record(db: Db, input: RecordCrmSyncInput): Promise<CrmSyncLog> {
    return db.crmSyncLog.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        operation: input.operation,
        entityType: input.entityType,
        entityId: input.entityId,
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        requestPayload: input.requestPayload as Prisma.InputJsonValue,
        responsePayload: input.responsePayload as Prisma.InputJsonValue,
      },
    });
  }
}
