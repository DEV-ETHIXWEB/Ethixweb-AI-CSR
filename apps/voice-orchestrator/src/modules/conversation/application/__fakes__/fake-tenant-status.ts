import type {
  TenantStatus,
  TenantStatusProvider,
} from "../../../capacity/domain/tenant-status.port";

export class FakeTenantStatusProvider implements TenantStatusProvider {
  status: TenantStatus = "active";

  async getStatus(_tenantId: string): Promise<TenantStatus> {
    return this.status;
  }
}
