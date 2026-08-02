import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { TenantContextService } from "../../../shared/prisma/tenant-context.service";
import type { Call } from "../domain/call.entity";
import { CallNotFoundError } from "../domain/errors";
import { CALL_REPOSITORY, type CallRepository } from "../domain/ports/call-repository.port";

@Injectable()
export class GetCallUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(CALL_REPOSITORY) private readonly callRepository: CallRepository,
  ) {}

  async execute(tenantId: string, callId: string): Promise<Call> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.call_id": callId });
    const call = await this.tenantContext.run(tenantId, (db) =>
      this.callRepository.findById(db, tenantId, callId),
    );
    if (!call) {
      throw new CallNotFoundError(callId);
    }
    return call;
  }
}
