import { Inject, Injectable } from "@nestjs/common";
import { GetCallUseCase } from "../../calls/application/get-call.use-case";
import { CallNotFoundError } from "../../calls/domain/errors";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Lead } from "../domain/lead.entity";
import {
  CUSTOMER_LOOKUP_PORT,
  callerOnLead,
  type CustomerLookupPort,
} from "../domain/ports/customer-lookup.port";
import { LEAD_REPOSITORY, type LeadRepository } from "../domain/ports/lead-repository.port";

/**
 * Re-copies the caller onto the lead THIS call created, after the caller
 * corrected their name or address once the lead was already saved. Keyed by
 * the call, so it can only ever touch that call's own lead, never an earlier
 * caller's lead on the same number (see callerOnLead). Nothing saved yet for
 * the call is not an error: there is simply nothing to refresh.
 */
@Injectable()
export class RefreshLeadCallerUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepository,
    @Inject(CUSTOMER_LOOKUP_PORT) private readonly customerLookupPort: CustomerLookupPort,
    private readonly getCallUseCase: GetCallUseCase,
  ) {}

  async execute(command: {
    tenantId: string;
    businessId: string;
    callId: string;
  }): Promise<Lead | null> {
    let call;
    try {
      call = await this.getCallUseCase.executeByTelephonyCallSid(command.tenantId, command.callId);
    } catch (error) {
      if (error instanceof CallNotFoundError) {
        return null;
      }
      throw error;
    }
    if (call.businessId !== command.businessId) {
      return null;
    }
    const lead = await this.tenantContext.run(command.tenantId, (db) =>
      this.leadRepository.findByCallId(db, command.tenantId, call.id),
    );
    if (!lead) {
      return null;
    }
    const customer = await this.customerLookupPort.findById(command.tenantId, lead.customerId);
    if (!customer) {
      return lead;
    }
    return this.tenantContext.run(command.tenantId, (db) =>
      this.leadRepository.updateFields(db, command.tenantId, lead.id, {
        qualificationData: callerOnLead(lead.qualificationData, customer),
      }),
    );
  }
}
