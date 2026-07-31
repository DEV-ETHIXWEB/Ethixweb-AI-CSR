import { randomUUID } from "node:crypto";
import { ConcurrentLeadModificationError, LeadCallIdAlreadyExistsError } from "../../domain/errors";
import type { Lead } from "../../domain/lead.entity";
import type {
  CreateLeadInput,
  Db,
  LeadRepository,
  ListLeadsOptions,
  ListLeadsResult,
  UpdateLeadFieldsInput,
} from "../../domain/ports/lead-repository.port";

export class FakeLeadRepository implements LeadRepository {
  private readonly leads = new Map<string, Lead>();

  // Synchronous body (no internal `await`) so this check-then-insert is
  // genuinely atomic with respect to other in-flight calls — mirrors the
  // real `UNIQUE(call_id)` DB constraint, and the same reasoning as
  // FakeCustomerRepository.create in the customers module.
  async create(_db: Db, input: CreateLeadInput): Promise<Lead> {
    for (const existing of this.leads.values()) {
      if (existing.tenantId === input.tenantId && existing.callId === input.callId) {
        throw new LeadCallIdAlreadyExistsError(input.callId);
      }
    }
    const now = new Date();
    const lead: Lead = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      customerId: input.customerId,
      callId: input.callId,
      crmLeadId: input.crmLeadId ?? null,
      problemSummary: input.problemSummary,
      priority: input.priority,
      leadType: input.leadType,
      status: "new",
      qualificationData: input.qualificationData ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.leads.set(lead.id, lead);
    return lead;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Lead | null> {
    const lead = this.leads.get(id);
    return lead && lead.tenantId === tenantId ? lead : null;
  }

  async findByCallId(_db: Db, tenantId: string, callId: string): Promise<Lead | null> {
    for (const lead of this.leads.values()) {
      if (lead.tenantId === tenantId && lead.callId === callId) {
        return lead;
      }
    }
    return null;
  }

  async findByCrmLeadId(_db: Db, tenantId: string, crmLeadId: string): Promise<Lead | null> {
    for (const lead of this.leads.values()) {
      if (lead.tenantId === tenantId && lead.crmLeadId === crmLeadId) {
        return lead;
      }
    }
    return null;
  }

  async setCrmLeadId(_db: Db, tenantId: string, id: string, crmLeadId: string): Promise<Lead> {
    const existing = this.mustFind(tenantId, id, "setCrmLeadId");
    const updated: Lead = { ...existing, crmLeadId, updatedAt: new Date() };
    this.leads.set(id, updated);
    return updated;
  }

  async updateFields(
    _db: Db,
    tenantId: string,
    id: string,
    patch: UpdateLeadFieldsInput,
  ): Promise<Lead> {
    const existing = this.mustFind(tenantId, id, "updateFields");
    const updated: Lead = {
      ...existing,
      ...(patch.problemSummary !== undefined ? { problemSummary: patch.problemSummary } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.leadType !== undefined ? { leadType: patch.leadType } : {}),
      updatedAt: new Date(),
    };
    this.leads.set(id, updated);
    return updated;
  }

  async updateStatus(
    _db: Db,
    tenantId: string,
    id: string,
    fromStatus: Lead["status"],
    toStatus: Lead["status"],
  ): Promise<Lead> {
    const existing = this.mustFind(tenantId, id, "updateStatus");
    // Conditional-update race check — mirrors the real
    // `WHERE id = id AND status = fromStatus` guard in
    // PrismaLeadRepository.updateStatus.
    if (existing.status !== fromStatus) {
      throw new ConcurrentLeadModificationError(id);
    }
    const updated: Lead = { ...existing, status: toStatus, updatedAt: new Date() };
    this.leads.set(id, updated);
    return updated;
  }

  async listByBusiness(
    _db: Db,
    tenantId: string,
    businessId: string,
    options: ListLeadsOptions,
  ): Promise<ListLeadsResult> {
    let matches = [...this.leads.values()].filter(
      (lead) => lead.tenantId === tenantId && lead.businessId === businessId,
    );
    if (options.status) {
      matches = matches.filter((lead) => lead.status === options.status);
    }
    if (options.priority) {
      matches = matches.filter((lead) => lead.priority === options.priority);
    }
    if (options.createdAfter) {
      const after = options.createdAfter;
      matches = matches.filter((lead) => lead.createdAt >= after);
    }
    if (options.createdBefore) {
      const before = options.createdBefore;
      matches = matches.filter((lead) => lead.createdAt <= before);
    }
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (options.page - 1) * options.pageSize;
    return { items: matches.slice(start, start + options.pageSize), total: matches.length };
  }

  /** Test helper — seed a lead directly, bypassing `create`. */
  seed(lead: Lead): void {
    this.leads.set(lead.id, lead);
  }

  private mustFind(tenantId: string, id: string, caller: string): Lead {
    const lead = this.leads.get(id);
    if (!lead || lead.tenantId !== tenantId) {
      throw new Error(`FakeLeadRepository.${caller}: no lead ${id} found for tenant ${tenantId}`);
    }
    return lead;
  }
}
