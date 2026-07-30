import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepository,
} from "../../domain/ports/api-key-repository.port";
import { ApiKeySecret } from "../../domain/value-objects/api-key-secret.vo";

export interface CreateApiKeyCommand {
  tenantId: string;
  scopes: string;
  expiresAt: Date | null;
}

export interface CreateApiKeyResult {
  id: string;
  /** Shown exactly once — the caller must store it now; it cannot be retrieved again (only the hash is persisted). */
  plaintextKey: string;
  scopes: string;
  expiresAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class CreateApiKeyUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeyRepository: ApiKeyRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: CreateApiKeyCommand): Promise<CreateApiKeyResult> {
    setSpanAttributes({ "ethixweb.tenant_id": command.tenantId });

    const secret = ApiKeySecret.generate();
    const apiKey = await this.tenantContext.run(command.tenantId, (db) =>
      this.apiKeyRepository.create(db, {
        tenantId: command.tenantId,
        keyHash: secret.hash,
        scopes: command.scopes,
        expiresAt: command.expiresAt,
      }),
    );

    setSpanAttributes({ "ethixweb.api_key_id": apiKey.id });
    // Never logs the plaintext or hash — only the key's own id, which is
    // meaningless without the secret that was shown to the caller once.
    this.logger.info("API key created", {
      tenantId: command.tenantId,
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes,
    });

    return {
      id: apiKey.id,
      plaintextKey: secret.plaintext,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }
}
