import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { TransferToHumanInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

export interface TransferToHumanOutput {
  /** The real, currently-on-call phone number to transfer to — see core-api's TransferToHumanUseCase for how it's resolved. `null` when no on-call target could be resolved. */
  transferDestination: string | null;
}

/**
 * The non-emergency counterpart to EscalateEmergencyHandler — see
 * core-api's TransferToHumanUseCase for why this tool exists and why it's
 * a separate signal from emergency escalation rather than a variant of it.
 */
@Injectable()
export class TransferToHumanHandler implements ToolHandler<
  TransferToHumanInput,
  TransferToHumanOutput
> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(
    input: TransferToHumanInput,
    context: ToolHandlerContext,
  ): Promise<TransferToHumanOutput> {
    return this.coreApiClient.post<TransferToHumanOutput>(
      "/internal/emergency-rules/transfer-to-human",
      {
        businessId: context.businessId,
        callId: context.callId,
        reason: input.reason,
        summary: input.summary,
      },
    );
  }
}
