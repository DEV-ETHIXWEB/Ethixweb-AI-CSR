import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Business } from "../domain/business.entity";
import {
  BUSINESS_REPOSITORY,
  type BusinessRepository,
} from "../domain/ports/business-repository.port";

@Injectable()
export class ListBusinessesUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(BUSINESS_REPOSITORY) private readonly businessRepository: BusinessRepository,
  ) {}

  /** Span attributes only — see GetTenantUseCase for why reads don't get an info-level log line. */
  async execute(tenantId: string): Promise<Business[]> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId });

    return this.tenantContext.run(tenantId, (db) =>
      this.businessRepository.listByTenant(db, tenantId),
    );
  }
}
