import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { CrmCredential } from "../domain/crm-credential";
import {
  CREDENTIAL_ENCRYPTOR,
  type CredentialEncryptor,
} from "../domain/ports/credential-encryptor.port";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";
import type { Integration } from "../domain/integration.entity";

export interface ConnectIntegrationCommand {
  tenantId: string;
  businessId: string;
  crmType: string;
  credential: CrmCredential;
}

/**
 * Stores an encrypted credential and creates the Integration row in
 * `pending_verification` status — connecting is deliberately separate from
 * verifying (VerifyIntegrationUseCase): storing credentials must not
 * silently claim they work before a real test call has confirmed it,
 * matching docs/15-tenant-lifecycle-billing-and-analytics.md §1's onboarding
 * step ("Verify connection... confirm credentials + adapter both work").
 */
@Injectable()
export class ConnectIntegrationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
    @Inject(CREDENTIAL_ENCRYPTOR) private readonly credentialEncryptor: CredentialEncryptor,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: ConnectIntegrationCommand): Promise<Integration> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const encryptedCredentials = await this.credentialEncryptor.encrypt(
      command.tenantId,
      command.credential,
    );

    const integration = await this.tenantContext.run(command.tenantId, (db) =>
      this.integrationRepository.create(db, {
        tenantId: command.tenantId,
        businessId: command.businessId,
        crmType: command.crmType,
        authType: command.credential.type,
        encryptedCredentials,
        config: {},
      }),
    );

    setSpanAttributes({ "ethixweb.integration_id": integration.id });
    // Never logs the credential itself, encrypted or not — only ids/type,
    // the same discipline as CreateApiKeyUseCase in the auth module.
    this.logger.info("CRM integration connected", {
      tenantId: command.tenantId,
      businessId: command.businessId,
      integrationId: integration.id,
      crmType: command.crmType,
    });

    return integration;
  }
}
