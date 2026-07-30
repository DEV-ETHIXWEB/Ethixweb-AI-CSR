import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { TenantNotFoundError } from "../domain/errors";
import { TENANT_REPOSITORY, type TenantRepository } from "../domain/ports/tenant-repository.port";
import type { Tenant } from "../domain/tenant.entity";

@Injectable()
export class GetTenantUseCase {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TENANT_REPOSITORY) private readonly tenantRepository: TenantRepository,
  ) {}

  // Span attributes only, deliberately no info-level log line: a read is
  // already captured by the auto-instrumented HTTP/DB spans, and logging
  // every GET at info level is noise a real on-call engineer would mute —
  // unlike create/transition, a read has no state change worth a log line
  // of its own. Reconsider only if a real debugging need for read-path
  // audit logging shows up (docs/08 §1.7's audit_logs table, not this
  // logger, is the mechanism for anything actually requiring an audit
  // trail).
  async execute(tenantId: string): Promise<Tenant> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId });

    const tenant = await this.tenantRepository.findById(this.prisma, tenantId);
    if (!tenant) {
      throw new TenantNotFoundError(tenantId);
    }
    return tenant;
  }
}
