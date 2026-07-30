import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import type { ApiKey } from "../../domain/api-key.entity";
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepository,
} from "../../domain/ports/api-key-repository.port";

@Injectable()
export class ListApiKeysUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeyRepository: ApiKeyRepository,
  ) {}

  async execute(tenantId: string): Promise<ApiKey[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId });
    return this.tenantContext.run(tenantId, (db) =>
      this.apiKeyRepository.listByTenant(db, tenantId),
    );
  }
}
