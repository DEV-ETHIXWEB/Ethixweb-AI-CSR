import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  CORE_API_CLIENT,
  type CoreApiClientPort,
} from "../../tool-broker/domain/ports/core-api-client.port";
import type { TenantStatus, TenantStatusProvider } from "../domain/tenant-status.port";

/** core-api's `GET /internal/tenant-status` response shape (tenants module's TenantStatusResponseDto, core-api repo). */
interface TenantStatusApiResponse {
  status: TenantStatus;
}

/**
 * CRITICAL: sits on StartConversationUseCase's hot path, called before
 * every call admission. Same fail-open discipline as
 * HttpCapacityConfigProvider's own core-api calls (see that class's own
 * comment) — a core-api outage must degrade to "serviceable" rather than
 * ever blocking every call for every tenant, see TenantStatusProvider's own
 * comment for why that tradeoff is deliberate.
 */
@Injectable()
export class HttpTenantStatusProvider implements TenantStatusProvider {
  private readonly logger = new Logger(HttpTenantStatusProvider.name);

  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async getStatus(tenantId: string): Promise<TenantStatus> {
    try {
      const response =
        await this.coreApiClient.get<TenantStatusApiResponse>("/internal/tenant-status");
      return response.status;
    } catch (error) {
      this.logger.warn(
        `core-api tenant-status fetch failed for tenant=${tenantId}, failing open as "active": ${String(error)}`,
      );
      return "active";
    }
  }
}
