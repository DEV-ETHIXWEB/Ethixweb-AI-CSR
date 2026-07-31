import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { CustomersModule } from "../customers/customers.module";
import { OUTBOX_WRITER_FACTORY } from "../../shared/outbox/outbox-writer-factory";
import { PrismaOutboxWriterFactory } from "../../shared/outbox/prisma-outbox-writer-factory";
import { ClaimLeadUseCase } from "./application/claim-lead.use-case";
import { CreateLeadUseCase } from "./application/create-lead.use-case";
import { GetLeadUseCase } from "./application/get-lead.use-case";
import { HandleLeadConvertedFromCrmUseCase } from "./application/handle-lead-converted-from-crm.use-case";
import { ListLeadsUseCase } from "./application/list-leads.use-case";
import { TransitionLeadStatusUseCase } from "./application/transition-lead-status.use-case";
import { UpdateLeadUseCase } from "./application/update-lead.use-case";
import { LEAD_CLAIM_REPOSITORY } from "./domain/ports/lead-claim-repository.port";
import { LEAD_REPOSITORY } from "./domain/ports/lead-repository.port";
import { PrismaLeadClaimRepository } from "./infrastructure/prisma-lead-claim.repository";
import { PrismaLeadRepository } from "./infrastructure/prisma-lead.repository";
import { LeadsController } from "./interfaces/leads.controller";

/**
 * `CrmModule` exports `CRM_LEAD_SYNC_PORT`, `CustomersModule` exports
 * `CUSTOMER_LOOKUP_PORT` — the only two things this module depends on from
 * its siblings, matching the dependency direction in the module roadmap
 * (Lead Management depends on CRM Integration and Customer Management,
 * never the reverse — neither of those modules imports LeadsModule; they
 * only reference this module's domain PORT TYPES, a compile-time-only,
 * DI-free dependency in the opposite direction, per each port file's own
 * comment).
 */
@Module({
  imports: [CrmModule, CustomersModule],
  controllers: [LeadsController],
  providers: [
    { provide: LEAD_REPOSITORY, useClass: PrismaLeadRepository },
    { provide: LEAD_CLAIM_REPOSITORY, useClass: PrismaLeadClaimRepository },
    // Already provided by CrmModule/CustomersModule under this same token,
    // but neither exports it — cheap (no state) to re-provide here rather
    // than reach into a sibling module's internals for something it
    // doesn't itself advertise as shared, same reasoning as
    // CustomersModule's own copy of this line.
    { provide: OUTBOX_WRITER_FACTORY, useClass: PrismaOutboxWriterFactory },
    CreateLeadUseCase,
    UpdateLeadUseCase,
    GetLeadUseCase,
    ListLeadsUseCase,
    ClaimLeadUseCase,
    TransitionLeadStatusUseCase,
    HandleLeadConvertedFromCrmUseCase,
  ],
  exports: [
    // CreateLeadUseCase/UpdateLeadUseCase are exported directly (not
    // behind a port token) for the future Voice AI module to inject —
    // there is no other module today that needs to invoke them, so no
    // port abstraction is warranted yet (YAGNI); LeadsController's own
    // comment documents why they aren't reachable over REST.
    CreateLeadUseCase,
    UpdateLeadUseCase,
    // HandleLeadConvertedFromCrmUseCase is exported for the crm module's
    // future webhook-event consumer to invoke once one exists — see its
    // own comment on why nothing calls it automatically yet.
    HandleLeadConvertedFromCrmUseCase,
  ],
})
export class LeadsModule {}
