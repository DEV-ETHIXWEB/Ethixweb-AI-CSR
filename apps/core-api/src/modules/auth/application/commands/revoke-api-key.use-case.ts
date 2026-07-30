import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import type { ApiKey } from "../../domain/api-key.entity";
import { ApiKeyNotFoundError } from "../../domain/errors";
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepository,
} from "../../domain/ports/api-key-repository.port";

@Injectable()
export class RevokeApiKeyUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeyRepository: ApiKeyRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(tenantId: string, apiKeyId: string): Promise<ApiKey> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.api_key_id": apiKeyId });

    return this.tenantContext.run(tenantId, async (db) => {
      // RLS already guarantees `existing` can only be a row belonging to
      // `tenantId` (or null) — findById's explicit tenantId parameter is
      // deliberate defense in depth on top of that, not a redundant check
      // (see the port's own comment on why: an in-memory test fake has no
      // equivalent of RLS to fall back on, so without this an IDOR bug
      // here could pass every unit test and only be caught by RLS in
      // production).
      const existing = await this.apiKeyRepository.findById(db, tenantId, apiKeyId);
      if (!existing) {
        throw new ApiKeyNotFoundError(apiKeyId);
      }

      const revoked = await this.apiKeyRepository.revoke(db, tenantId, apiKeyId, new Date());
      this.logger.info("API key revoked", { tenantId, apiKeyId });
      return revoked;
    });
  }
}
