import type {
  AuditLogRepository,
  Db,
  RecordAuditLogEntry,
} from "../../../../shared/audit/audit-log-repository.port";

export class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: RecordAuditLogEntry[] = [];

  async record(_db: Db, entry: RecordAuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}
