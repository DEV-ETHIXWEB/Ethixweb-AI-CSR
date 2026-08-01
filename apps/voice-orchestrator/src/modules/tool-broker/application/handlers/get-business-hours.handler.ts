import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { GetBusinessHoursInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

export interface GetBusinessHoursOutput {
  isOpen: boolean;
  opensAt?: string | null;
  isHoliday: boolean;
}

/**
 * docs/04 §3.6 `getBusinessHours` — delegates to core-api's
 * emergency-rules module (GetBusinessHoursUseCase) via
 * EmergencyRulesToolController, now that it exists (Phase 7). Closes the
 * Technical Debt item this handler's own comment previously flagged: it
 * used to return a hardcoded documented-fallback response because no
 * backing module existed; that fallback now lives correctly INSIDE
 * GetBusinessHoursUseCase itself (still applied on any failure, still
 * "never falsely tells a caller the office is open" — just for real, not
 * unconditionally).
 */
@Injectable()
export class GetBusinessHoursHandler implements ToolHandler<
  GetBusinessHoursInput,
  GetBusinessHoursOutput
> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(
    input: GetBusinessHoursInput,
    _context: ToolHandlerContext,
  ): Promise<GetBusinessHoursOutput> {
    return this.coreApiClient.get<GetBusinessHoursOutput>(
      `/internal/emergency-rules/business-hours?businessId=${encodeURIComponent(input.business_id)}`,
    );
  }
}
