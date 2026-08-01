import type { ToolAuditLogPort, ToolCallAuditRecord } from "../../domain/ports/tool-audit-log.port";

export class FakeToolAuditLog implements ToolAuditLogPort {
  readonly records: ToolCallAuditRecord[] = [];

  async record(entry: ToolCallAuditRecord): Promise<void> {
    this.records.push(entry);
  }
}
