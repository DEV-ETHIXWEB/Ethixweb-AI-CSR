import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Integration } from "../domain/integration.entity";
import {
  INTEGRATION_REPOSITORY,
  type IntegrationRepository,
} from "../domain/ports/integration-repository.port";

@Injectable()
export class ListIntegrationsUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(INTEGRATION_REPOSITORY) private readonly integrationRepository: IntegrationRepository,
  ) {}

  async execute(tenantId: string, businessId: string): Promise<Integration[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.business_id": businessId });

    return this.tenantContext.run(tenantId, (db) =>
      this.integrationRepository.listByBusiness(db, tenantId, businessId),
    );
  }
}
