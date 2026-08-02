import { Injectable } from "@nestjs/common";
import { Prisma, type LeadStatus } from "@ethixweb/database";
import {
  CallNotFoundForLeadError,
  ConcurrentLeadModificationError,
  LeadCallIdAlreadyExistsError,
} from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import type {
  CreateLeadInput,
  Db,
  LeadRepository,
  ListLeadsOptions,
  ListLeadsResult,
  UpdateLeadFieldsInput,
} from "../domain/ports/lead-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
const FOREIGN_KEY_VIOLATION = "P2003";

type LeadRow = {
  id: string;
  tenantId: string;
  businessId: string;
  customerId: string;
  callId: string;
  crmLeadId: string | null;
  problemSummary: string;
  priority: string;
  leadType: string;
  status: LeadStatus;
  qualificationData: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: LeadRow): Lead {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    customerId: row.customerId,
    callId: row.callId,
    crmLeadId: row.crmLeadId,
    problemSummary: row.problemSummary,
    priority: row.priority,
    leadType: row.leadType,
    status: row.status,
    qualificationData: (row.qualificationData ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaLeadRepository implements LeadRepository {
  async create(db: Db, input: CreateLeadInput): Promise<Lead> {
    try {
      const row = await db.lead.create({
        data: {
          tenantId: input.tenantId,
          businessId: input.businessId,
          customerId: input.customerId,
          callId: input.callId,
          crmLeadId: input.crmLeadId ?? null,
          problemSummary: input.problemSummary,
          priority: input.priority,
          leadType: input.leadType,
          qualificationData: (input.qualificationData ?? {}) as Prisma.InputJsonValue,
        },
      });
      return toEntity(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === UNIQUE_CONSTRAINT_VIOLATION) {
          throw new LeadCallIdAlreadyExistsError(input.callId);
        }
        if (error.code === FOREIGN_KEY_VIOLATION) {
          throw new CallNotFoundForLeadError(input.callId);
        }
      }
      throw error;
    }
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Lead | null> {
    const row = await db.lead.findFirst({ where: { id, tenantId } });
    return row ? toEntity(row) : null;
  }

  async findByCallId(db: Db, tenantId: string, callId: string): Promise<Lead | null> {
    const row = await db.lead.findFirst({ where: { tenantId, callId } });
    return row ? toEntity(row) : null;
  }

  async findByCrmLeadId(db: Db, tenantId: string, crmLeadId: string): Promise<Lead | null> {
    const row = await db.lead.findFirst({ where: { tenantId, crmLeadId } });
    return row ? toEntity(row) : null;
  }

  async setCrmLeadId(db: Db, tenantId: string, id: string, crmLeadId: string): Promise<Lead> {
    const { count } = await db.lead.updateMany({ where: { id, tenantId }, data: { crmLeadId } });
    if (count === 0) {
      throw new Error(
        `PrismaLeadRepository.setCrmLeadId: no lead ${id} found for tenant ${tenantId}`,
      );
    }
    return this.mustFind(db, tenantId, id, "setCrmLeadId");
  }

  async updateFields(
    db: Db,
    tenantId: string,
    id: string,
    patch: UpdateLeadFieldsInput,
  ): Promise<Lead> {
    // Conditional key inclusion, not `field: patch.field ?? existingValue` —
    // a genuine partial update (an omitted field means "leave it alone"),
    // the same fix already applied to the customers module's
    // updateCrmCache after that exact bug was found during its own review.
    const data: Prisma.LeadUpdateManyMutationInput = {};
    if (patch.problemSummary !== undefined) {
      data.problemSummary = patch.problemSummary;
    }
    if (patch.priority !== undefined) {
      data.priority = patch.priority;
    }
    if (patch.leadType !== undefined) {
      data.leadType = patch.leadType;
    }

    const { count } = await db.lead.updateMany({ where: { id, tenantId }, data });
    if (count === 0) {
      throw new Error(
        `PrismaLeadRepository.updateFields: no lead ${id} found for tenant ${tenantId}`,
      );
    }
    return this.mustFind(db, tenantId, id, "updateFields");
  }

  async updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
  ): Promise<Lead> {
    const { count } = await db.lead.updateMany({
      where: { id, tenantId, status: fromStatus },
      data: { status: toStatus },
    });
    if (count === 0) {
      throw new ConcurrentLeadModificationError(id);
    }
    return this.mustFind(db, tenantId, id, "updateStatus");
  }

  async listByBusiness(
    db: Db,
    tenantId: string,
    businessId: string,
    options: ListLeadsOptions,
  ): Promise<ListLeadsResult> {
    const where: Prisma.LeadWhereInput = {
      tenantId,
      businessId,
      ...(options.status ? { status: options.status } : {}),
      ...(options.priority ? { priority: options.priority } : {}),
      ...(options.createdAfter || options.createdBefore
        ? {
            createdAt: {
              ...(options.createdAfter ? { gte: options.createdAfter } : {}),
              ...(options.createdBefore ? { lte: options.createdBefore } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      }),
      db.lead.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }

  private async mustFind(db: Db, tenantId: string, id: string, caller: string): Promise<Lead> {
    const updated = await db.lead.findFirst({ where: { id, tenantId } });
    if (!updated) {
      // Unreachable in practice (we just updated it inside the same
      // tenant-scoped transaction) — satisfies the non-null return type
      // without a non-null assertion, the same pattern used throughout
      // this codebase (e.g. PrismaApiKeyRepository.revoke).
      throw new Error(`PrismaLeadRepository.${caller}: lead ${id} vanished after update`);
    }
    return toEntity(updated);
  }
}
