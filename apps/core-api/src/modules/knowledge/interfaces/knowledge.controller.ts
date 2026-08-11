import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { ApproveKnowledgeItemUseCase } from "../application/approve-knowledge-item.use-case";
import { CreateKnowledgeItemUseCase } from "../application/create-knowledge-item.use-case";
import { DisableKnowledgeItemUseCase } from "../application/disable-knowledge-item.use-case";
import { GetKnowledgeItemUseCase } from "../application/get-knowledge-item.use-case";
import { ListKnowledgeItemsUseCase } from "../application/list-knowledge-items.use-case";
import { UpdateKnowledgeItemUseCase } from "../application/update-knowledge-item.use-case";
import { CreateKnowledgeItemDto } from "./dto/create-knowledge-item.dto";
import { KnowledgeItemResponseDto } from "./dto/knowledge-item-response.dto";
import { ListKnowledgeQueryDto } from "./dto/list-knowledge-query.dto";
import { PaginatedKnowledgeResponseDto } from "./dto/paginated-knowledge-response.dto";
import { UpdateKnowledgeItemDto } from "./dto/update-knowledge-item.dto";

/** The dispatcher/owner-facing knowledge base CRUD + review workflow (docs/38). */
@ApiBearerAuth("bearer")
@ApiSecurity("api-key")
@ApiTags("knowledge")
@Roles("owner", "admin")
@Controller("dashboard/knowledge")
export class KnowledgeController {
  constructor(
    private readonly listKnowledgeItemsUseCase: ListKnowledgeItemsUseCase,
    private readonly getKnowledgeItemUseCase: GetKnowledgeItemUseCase,
    private readonly createKnowledgeItemUseCase: CreateKnowledgeItemUseCase,
    private readonly updateKnowledgeItemUseCase: UpdateKnowledgeItemUseCase,
    private readonly approveKnowledgeItemUseCase: ApproveKnowledgeItemUseCase,
    private readonly disableKnowledgeItemUseCase: DisableKnowledgeItemUseCase,
  ) {}

  @Get()
  @ApiQuery({ name: "businessId", required: true })
  @ApiOperation({ summary: "List/filter a business's knowledge base items" })
  @ApiResponse({ status: 200, type: PaginatedKnowledgeResponseDto })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query() query: ListKnowledgeQueryDto,
  ): Promise<PaginatedKnowledgeResponseDto> {
    const result = await this.listKnowledgeItemsUseCase.execute({
      tenantId: principal.tenantId,
      businessId: query.businessId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      category: query.category,
      aiKnowledge: query.aiKnowledge,
      waitingBrochure: query.waitingBrochure,
    });
    return PaginatedKnowledgeResponseDto.fromDomain(result);
  }

  @Get(":id")
  @ApiOperation({ summary: "Fetch one of the caller's own tenant's knowledge items by id" })
  @ApiResponse({ status: 200, type: KnowledgeItemResponseDto })
  @ApiResponse({ status: 404, description: "No such knowledge item for the caller's tenant" })
  async findOne(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeItemResponseDto> {
    const item = await this.getKnowledgeItemUseCase.execute(principal.tenantId, id);
    return KnowledgeItemResponseDto.fromDomain(item);
  }

  @Post()
  @ApiOperation({ summary: "Create a knowledge item — always starts in draft status" })
  @ApiResponse({ status: 201, type: KnowledgeItemResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: CreateKnowledgeItemDto,
  ): Promise<KnowledgeItemResponseDto> {
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const item = await this.createKnowledgeItemUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      businessId: dto.businessId,
      category: dto.category,
      title: dto.title,
      content: dto.content,
      aiKnowledge: dto.aiKnowledge,
      waitingBrochure: dto.waitingBrochure,
      priority: dto.priority,
      createdByUserId: jwtPrincipal.userId,
    });
    return KnowledgeItemResponseDto.fromDomain(item);
  }

  @Patch(":id")
  @ApiOperation({
    summary:
      "Patch a knowledge item's content/config. Editing the CONTENT of an approved item reverts it to draft (docs/38).",
  })
  @ApiResponse({ status: 200, type: KnowledgeItemResponseDto })
  @ApiResponse({ status: 404, description: "No such knowledge item for the caller's tenant" })
  async update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateKnowledgeItemDto,
  ): Promise<KnowledgeItemResponseDto> {
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const item = await this.updateKnowledgeItemUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      itemId: id,
      actorUserId: jwtPrincipal.userId,
      patch: {
        title: dto.title,
        content: dto.content,
        category: dto.category,
        aiKnowledge: dto.aiKnowledge,
        waitingBrochure: dto.waitingBrochure,
        priority: dto.priority,
      },
    });
    return KnowledgeItemResponseDto.fromDomain(item);
  }

  @Post(":id/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve a draft knowledge item — only valid from draft" })
  @ApiResponse({ status: 200, type: KnowledgeItemResponseDto })
  @ApiResponse({ status: 404, description: "No such knowledge item for the caller's tenant" })
  @ApiResponse({ status: 422, description: "Illegal transition from the item's current status" })
  async approve(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeItemResponseDto> {
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const item = await this.approveKnowledgeItemUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      itemId: id,
      actorUserId: jwtPrincipal.userId,
    });
    return KnowledgeItemResponseDto.fromDomain(item);
  }

  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Disable a knowledge item — valid from draft or approved" })
  @ApiResponse({ status: 200, type: KnowledgeItemResponseDto })
  @ApiResponse({ status: 404, description: "No such knowledge item for the caller's tenant" })
  @ApiResponse({ status: 422, description: "Illegal transition from the item's current status" })
  async disable(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<KnowledgeItemResponseDto> {
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const item = await this.disableKnowledgeItemUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      itemId: id,
      actorUserId: jwtPrincipal.userId,
    });
    return KnowledgeItemResponseDto.fromDomain(item);
  }
}
