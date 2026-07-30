import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import { IntegrationNotFoundError } from "../domain/errors";
import type { Integration } from "../domain/integration.entity";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";

@Injectable()
export class GetIntegrationUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
  ) {}

  async execute(tenantId: string, integrationId: string): Promise<Integration> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.integration_id": integrationId });

    const integration = await this.tenantContext.run(tenantId, (db) =>
      this.integrationRepository.findById(db, tenantId, integrationId),
    );
    if (!integration) {
      throw new IntegrationNotFoundError(integrationId);
    }
    return integration;
  }
}
