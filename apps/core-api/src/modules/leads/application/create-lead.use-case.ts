import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { GetCallUseCase } from "../../calls/application/get-call.use-case";
import { CallNotFoundError } from "../../calls/domain/errors";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import {
  OUTBOX_WRITER_FACTORY,
  type OutboxWriterFactory,
} from "../../../shared/outbox/outbox-writer-factory";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import {
  CallNotFoundForLeadError,
  CustomerNotFoundForLeadError,
  LeadCallIdAlreadyExistsError,
} from "../domain/errors";
import type { Lead } from "../domain/lead.entity";
import { CRM_LEAD_SYNC_PORT, type CrmLeadSyncPort } from "../domain/ports/crm-lead-sync.port";
import {
  CUSTOMER_LOOKUP_PORT,
  type CustomerLookupPort,
} from "../domain/ports/customer-lookup.port";
import {
  LEAD_REPOSITORY,
  type Db,
  type LeadRepository,
} from "../domain/ports/lead-repository.port";

export interface CreateLeadCommand {
  tenantId: string;
  businessId: string;
  customerId: string;
  callId: string;
  problemSummary: string;
  priority: string;
  leadType: string;
  qualificationData?: Record<string, unknown> | undefined;
}

/**
 * docs/04-ai-tool-architecture.md §3.3's `createLead` tool — "the single
 * commit action of a qualifying call." Two load-bearing, documented
 * requirements this implementation exists to satisfy:
 *
 * 1. **Never blocks the conversation because the CRM is unreachable.** The
 *    CRM write is attempted exactly once here (the underlying adapter,
 *    resolved through crm's own CrmAdapterRegistry, already applies its own
 *    circuit-breaker + retry policy per docs/05 §1 — this use-case does
 *    NOT add a second, redundant retry layer on top of that one). If it
 *    fails for ANY reason (CRM down, no active integration connected,
 *    credentials invalid), the lead is still recorded locally with
 *    `crmLeadId: null` — never an error back to the caller. "A background
 *    job keeps retrying" beyond this point (docs/04's own wording) is
 *    explicitly NOT built here: no job-queue/worker infrastructure exists
 *    yet anywhere in this codebase (the same honest limitation already
 *    flagged for the outbox relay in the crm module) — `crmLeadId IS NULL`
 *    is the durable, queryable signal for "still needs CRM sync," ready
 *    for that worker whenever it's built.
 * 2. **Exactly one lead per call_id**, enforced by the DB's own
 *    `UNIQUE(call_id)` constraint, not just an application-layer check —
 *    docs/04's own words: "a hard constraint, not just a soft key." Two
 *    concurrent createLead calls for the same call_id (e.g. the tool
 *    broker retrying after a lost response) both succeed here, returning
 *    the SAME local lead — mirrors the customers module's
 *    CustomerCacheUpserter race-handling exactly, for the identical reason.
 */
@Injectable()
export class CreateLeadUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(CUSTOMER_LOOKUP_PORT) private readonly customerLookupPort: CustomerLookupPort,
    @Inject(CRM_LEAD_SYNC_PORT) private readonly crmLeadSyncPort: CrmLeadSyncPort,
    @Inject(OUTBOX_WRITER_FACTORY) private readonly outboxWriterFactory: OutboxWriterFactory,
    private readonly getCallUseCase: GetCallUseCase,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateLeadCommand): Promise<Lead> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const customer = await this.customerLookupPort.findById(command.tenantId, command.customerId);
    if (!customer || customer.businessId !== command.businessId) {
      // Same error either way: a customer id from a different business
      // shouldn't confirm to the caller that it exists elsewhere.
      throw new CustomerNotFoundForLeadError(command.customerId);
    }

    // SECURITY: verify the call actually belongs to this tenant/business
    // BEFORE any CRM sync attempt or DB write. Found live, under real
    // adversarial testing (not a hypothetical): `Lead.callId`'s only
    // pre-existing guard was the Postgres FK constraint proving a Call row
    // exists SOMEWHERE — it does not, and cannot, prove that row belongs to
    // the calling tenant. Without this check, tenant A could successfully
    // create a Lead keyed by tenant B's real callId (cross-tenant data
    // corruption — the resulting Lead row and its CRM sync both point at
    // tenant B's call under tenant A's tenantId), AND because
    // `leads.call_id` is correctly a GLOBAL unique constraint (Call.id is
    // already globally unique — the constraint is right, the missing
    // ownership check was the bug), tenant A's row permanently blocks
    // tenant B from ever creating their OWN legitimate lead for that call:
    // tenant B's later insert hits the same unique-constraint violation,
    // but the RLS-scoped recovery read finds nothing (the existing row
    // belongs to tenant A, invisible under tenant B's RLS context), which
    // surfaced as an unhandled 500 rather than a clean rejection.
    // GetCallUseCase.findById is already tenant-scoped
    // (`WHERE id = ? AND tenantId = ?`) — reused here rather than
    // duplicating that query, the same pattern CallsModule's own comment
    // already anticipated ("exported... for the future Voice AI module to
    // inject").
    let call;
    try {
      call = await this.getCallUseCase.execute(command.tenantId, command.callId);
    } catch (error) {
      if (error instanceof CallNotFoundError) {
        throw new CallNotFoundForLeadError(command.callId);
      }
      throw error;
    }
    if (call.businessId !== command.businessId) {
      // Same error either way as "no such call" — a real call id from a
      // different business under the SAME tenant shouldn't confirm to the
      // caller that it exists elsewhere, identical reasoning to the
      // customer-business check above.
      throw new CallNotFoundForLeadError(command.callId);
    }

    const crmLeadId = await this.attemptCrmSync(command, customer.crmCustomerId);

    return this.tenantContext.run(command.tenantId, async (db) => {
      const { lead, created } = await this.upsertByCallId(db, command, crmLeadId);

      if (created) {
        await this.outboxWriterFactory.forDb(db).write({
          tenantId: lead.tenantId,
          aggregateType: "lead",
          aggregateId: lead.id,
          eventType: "lead.created",
          payload: { leadId: lead.id, businessId: lead.businessId, callId: lead.callId },
          dedupKey: `lead.created:${lead.id}`,
        });
        this.logger.info("lead created", {
          tenantId: lead.tenantId,
          businessId: lead.businessId,
          leadId: lead.id,
          crmSynced: lead.crmLeadId !== null,
        });
      } else {
        this.logger.info(
          "createLead raced with a concurrent call for the same call_id — returned the existing lead",
          {
            tenantId: lead.tenantId,
            leadId: lead.id,
          },
        );
      }

      return lead;
    });
  }

  /** Best-effort — never throws. Returns null on any failure (no active integration, no crmCustomerId to link to yet, or the CRM call itself failing after its own retry policy is exhausted). */
  private async attemptCrmSync(
    command: CreateLeadCommand,
    crmCustomerId: string | null,
  ): Promise<string | null> {
    if (!crmCustomerId) {
      return null;
    }
    try {
      const integrationId = await this.crmLeadSyncPort.resolveActiveIntegrationId(
        command.tenantId,
        command.businessId,
      );
      if (!integrationId) {
        return null;
      }
      const result = await this.crmLeadSyncPort.createLead(command.tenantId, integrationId, {
        crmCustomerId,
        problemSummary: command.problemSummary,
        priority: command.priority,
        leadType: command.leadType,
      });
      return result.crmLeadId;
    } catch (error) {
      this.logger.warn("CRM lead sync failed — proceeding with a local-only lead", {
        tenantId: command.tenantId,
        businessId: command.businessId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async upsertByCallId(
    db: Db,
    command: CreateLeadCommand,
    crmLeadId: string | null,
  ): Promise<{ lead: Lead; created: boolean }> {
    // A SAVEPOINT taken immediately before the insert attempt — Postgres
    // aborts the ENTIRE enclosing transaction after any error (including a
    // unique-constraint violation), so without this, every query after the
    // catch below (starting with findByCallId) fails with `25P02: current
    // transaction is aborted, commands ignored until end of transaction
    // block`, even though the code looks like it's "handling" the race.
    // Found under genuine concurrent-request load against a real Postgres
    // instance — no mocked-repository unit test can catch this, since the
    // mock never actually poisons a transaction the way real Postgres does.
    await db.$executeRaw`SAVEPOINT create_lead_attempt`;
    try {
      const lead = await this.leadRepository.create(db, {
        tenantId: command.tenantId,
        businessId: command.businessId,
        customerId: command.customerId,
        callId: command.callId,
        crmLeadId,
        problemSummary: command.problemSummary,
        priority: command.priority,
        leadType: command.leadType,
        qualificationData: command.qualificationData,
      });
      return { lead, created: true };
    } catch (error) {
      if (!(error instanceof LeadCallIdAlreadyExistsError)) {
        throw error;
      }
      // Un-poisons the transaction so the recovery read below can actually
      // run — see the SAVEPOINT comment above.
      await db.$executeRaw`ROLLBACK TO SAVEPOINT create_lead_attempt`;
      let existing = await this.leadRepository.findByCallId(db, command.tenantId, command.callId);
      if (!existing) {
        throw new Error(
          `CreateLeadUseCase: constraint violation for call ${command.callId} but no row found on re-fetch`,
        );
      }
      // Salvage: this losing attempt's own CRM sync may have succeeded even
      // though the winning row's didn't (each concurrent call attempts its
      // own CRM write independently) — persist that crmLeadId onto the
      // winning row rather than silently discarding a real CRM-side lead
      // this platform now has no other record of.
      if (crmLeadId && !existing.crmLeadId) {
        existing = await this.leadRepository.setCrmLeadId(
          db,
          command.tenantId,
          existing.id,
          crmLeadId,
        );
      }
      return { lead: existing, created: false };
    }
  }
}
