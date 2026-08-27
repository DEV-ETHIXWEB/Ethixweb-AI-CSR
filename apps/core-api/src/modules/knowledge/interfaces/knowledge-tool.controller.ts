import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { ListAiKnowledgeItemsUseCase } from "../application/list-ai-knowledge-items.use-case";
import { ListWaitingBrochureItemsUseCase } from "../application/list-waiting-brochure-items.use-case";
import { AiKnowledgeItemResponseDto } from "./dto/ai-knowledge-item-response.dto";
import { WaitingBrochureItemResponseDto } from "./dto/waiting-brochure-item-response.dto";

/**
 * voice-orchestrator's runtime-facing read surface — role-unrestricted,
 * API-key-only, matching UsageToolController/CallsToolController's exact
 * pattern (see either's own comment).
 */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("internal-tools")
@Controller("internal/knowledge")
export class KnowledgeToolController {
  constructor(
    private readonly listWaitingBrochureItemsUseCase: ListWaitingBrochureItemsUseCase,
    private readonly listAiKnowledgeItemsUseCase: ListAiKnowledgeItemsUseCase,
  ) {}

  @Get(":businessId/waiting-brochure")
  @ApiOperation({
    summary:
      "Approved, waiting-brochure-flagged knowledge items for a business, priority-ordered — feeds voice-orchestrator's waiting/brochure rotation (docs/36)",
  })
  @ApiResponse({ status: 200, type: [WaitingBrochureItemResponseDto] })
  async waitingBrochure(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
  ): Promise<WaitingBrochureItemResponseDto[]> {
    const items = await this.listWaitingBrochureItemsUseCase.execute(
      principal.tenantId,
      businessId,
    );
    return items.map((item) => WaitingBrochureItemResponseDto.fromDomain(item));
  }

  @Get(":businessId/ai-knowledge")
  @ApiOperation({
    summary:
      "Approved, ai-knowledge-flagged knowledge items for a business, priority-ordered — feeds voice-orchestrator's system-prompt assembly (docs/38) so approved facts (pricing policy, warranty terms, service details) reach the model instead of living only in the dashboard.",
  })
  @ApiResponse({ status: 200, type: [AiKnowledgeItemResponseDto] })
  async aiKnowledge(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("businessId", ParseUUIDPipe) businessId: string,
  ): Promise<AiKnowledgeItemResponseDto[]> {
    const items = await this.listAiKnowledgeItemsUseCase.execute(principal.tenantId, businessId);
    return items.map((item) => AiKnowledgeItemResponseDto.fromDomain(item));
  }
}
