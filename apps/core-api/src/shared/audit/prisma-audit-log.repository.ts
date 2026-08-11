import { Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import type { AuditLogRepository, Db, RecordAuditLogEntry } from "./audit-log-repository.port";

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  async record(db: Db, entry: RecordAuditLogEntry): Promise<void> {
    // Conditional key inclusion, not `before: entry.before ?? undefined` —
    // with `exactOptionalPropertyTypes: true`, Prisma's generated
    // `AuditLogUncheckedCreateInput` type does not accept an explicit
    // `undefined` for `before`/`after` (only a real JSON value or the key
    // omitted entirely), the same discipline this codebase already applies
    // to every other conditional Prisma write (see e.g.
    // PrismaLeadRepository.updateFields's own comment on this exact
    // pattern).
    await db.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorId: entry.actorId,
        actorType: entry.actorType,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        ...(entry.before !== undefined ? { before: entry.before as Prisma.InputJsonValue } : {}),
        ...(entry.after !== undefined ? { after: entry.after as Prisma.InputJsonValue } : {}),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
