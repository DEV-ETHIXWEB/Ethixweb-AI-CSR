import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { CreateLeadInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

interface LeadResponse {
  id: string;
}

export interface CreateLeadOutput {
  lead_id: string;
  status: "created";
}

/** docs/04 §3.3 `createLead` — the single "commit" action. Delegates to leads module's CreateLeadUseCase via LeadsToolController, which already never blocks on CRM reachability (see that use-case's own comment). */
@Injectable()
export class CreateLeadHandler implements ToolHandler<CreateLeadInput, CreateLeadOutput> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(input: CreateLeadInput, context: ToolHandlerContext): Promise<CreateLeadOutput> {
    const result = await this.coreApiClient.post<LeadResponse>("/internal/leads", {
      businessId: context.businessId,
      customerId: input.customer_id,
      callId: context.callId,
      problemSummary: input.problem_summary,
      priority: input.priority,
      leadType: input.lead_type,
    });
    return { lead_id: result.id, status: "created" };
  }
}
