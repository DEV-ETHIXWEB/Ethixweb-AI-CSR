import { Inject, Injectable } from "@nestjs/common";
import { authApiKeyAuthenticationsCounter } from "../../../../shared/observability/metrics";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { PrismaService } from "../../../../shared/prisma/prisma.service";
import { InvalidApiKeyError } from "../../domain/errors";
import {
  API_KEY_REPOSITORY,
  type ApiKeyRepository,
} from "../../domain/ports/api-key-repository.port";
import { ApiKeySecret } from "../../domain/value-objects/api-key-secret.vo";

export interface ApiKeyPrincipal {
  apiKeyId: string;
  tenantId: string;
  scopes: string;
}

/**
 * Runs against the plain `PrismaService`, never a tenant-scoped
 * transaction — per docs/20-architecture-decision-records.md ADR-015, this
 * is the one deliberate exception, backed by the `lookup_api_key_for_auth`
 * SECURITY DEFINER function rather than a normal RLS-protected query.
 */
@Injectable()
export class AuthenticateApiKeyUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeyRepository: ApiKeyRepository,
  ) {}

  async execute(plaintextKey: string): Promise<ApiKeyPrincipal> {
    const keyHash = ApiKeySecret.hashOf(plaintextKey);
    const lookup = await this.apiKeyRepository.findActiveByKeyHashForAuth(this.prisma, keyHash);

    if (!lookup) {
      authApiKeyAuthenticationsCounter.add(1, { outcome: "invalid_key" });
      throw new InvalidApiKeyError();
    }
    const now = new Date();
    if (lookup.revokedAt !== null || (lookup.expiresAt !== null && lookup.expiresAt <= now)) {
      authApiKeyAuthenticationsCounter.add(1, { outcome: "invalid_key" });
      throw new InvalidApiKeyError();
    }

    setSpanAttributes({
      "ethixweb.tenant_id": lookup.tenantId,
      "ethixweb.api_key_id": lookup.id,
    });
    authApiKeyAuthenticationsCounter.add(1, { outcome: "success" });

    return { apiKeyId: lookup.id, tenantId: lookup.tenantId, scopes: lookup.scopes };
  }
}
