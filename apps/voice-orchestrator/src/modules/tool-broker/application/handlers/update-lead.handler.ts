import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { UpdateLeadInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

export interface UpdateLeadOutput {
  lead_id: string;
  updated: true;
}

/** docs/04 §3.4 `updateLead` — delegates to leads module's UpdateLeadUseCase via LeadsToolController, which enforces "only callable within the same call_id that created the lead." */
@Injectable()
export class UpdateLeadHandler implements ToolHandler<UpdateLeadInput, UpdateLeadOutput> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(input: UpdateLeadInput, context: ToolHandlerContext): Promise<UpdateLeadOutput> {
    await this.coreApiClient.patch(`/internal/leads/${input.lead_id}`, {
      callId: context.callId,
      problemSummary: input.patch.problem_summary,
      priority: input.patch.priority,
      leadType: input.patch.lead_type,
    });
    return { lead_id: input.lead_id, updated: true };
  }
}
