import { randomUUID } from "node:crypto";
import type { CrmSyncLog } from "../../domain/crm-sync-log.entity";
import type {
  CrmSyncLogRepository,
  Db,
  RecordCrmSyncInput,
} from "../../domain/ports/crm-sync-log-repository.port";

export class FakeCrmSyncLogRepository implements CrmSyncLogRepository {
  readonly records: CrmSyncLog[] = [];

  async record(_db: Db, input: RecordCrmSyncInput): Promise<CrmSyncLog> {
    const entry: CrmSyncLog = { ...input, id: randomUUID(), createdAt: new Date() };
    this.records.push(entry);
    return entry;
  }
}
