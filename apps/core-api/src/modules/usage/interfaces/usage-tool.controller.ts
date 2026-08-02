import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { RecordUsageUseCase } from "../application/record-usage.use-case";
import { RecordUsageDto } from "./dto/record-usage.dto";
import { UsageRecordResponseDto } from "./dto/usage-record-response.dto";

/**
 * docs/26-usage-metering.md §2's ingestion surface — separate from
 * UsageController for the identical reason LeadsToolController is separate
 * from LeadsController (see either's own comment): role-unrestricted,
 * API-key-only, no `@Roles()`. This is voice-orchestrator's (and any
 * future internal caller's) entire interface to usage ingestion — it
 * records a normalized usage event without the calling module knowing
 * anything about billing/pricing internals, per this phase's own stated
 * boundary.
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/usage")
export class UsageToolController {
  constructor(private readonly recordUsageUseCase: RecordUsageUseCase) {}

  @Post()
  @ApiOperation({
    summary: "docs/26 §2 — record one normalized usage event, tool-broker/service-facing",
  })
  @ApiResponse({
    status: 201,
    description: "Usage recorded (or the existing record, on a dedupKey replay)",
    type: UsageRecordResponseDto,
  })
  @ApiResponse({ status: 422, description: "Invalid quantity or occurredAt in the future" })
  async record(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: RecordUsageDto,
  ): Promise<UsageRecordResponseDto> {
    const record = await this.recordUsageUseCase.execute({
      tenantId: principal.tenantId,
      businessId: dto.businessId,
      callId: dto.callId,
      leadId: dto.leadId,
      usageType: dto.usageType,
      source: dto.source,
      quantity: dto.quantity,
      unit: dto.unit,
      estimatedProviderCostUsd: dto.estimatedProviderCostUsd,
      dedupKey: dto.dedupKey,
      metadata: dto.metadata,
      occurredAt: dto.occurredAt,
    });
    return UsageRecordResponseDto.fromDomain(record);
  }
}
