import { UnknownCrmTypeError } from "../../domain/errors";
import type { CRMAdapter } from "../../domain/ports/crm-adapter.port";
import type { CrmAdapterRegistry } from "../../domain/ports/crm-adapter-registry.port";

export class FakeCrmAdapterRegistry implements CrmAdapterRegistry {
  constructor(private readonly adapters: Record<string, CRMAdapter>) {}

  resolve(crmType: string, _tenantId: string): CRMAdapter {
    const adapter = this.adapters[crmType];
    if (!adapter) {
      throw new UnknownCrmTypeError(crmType);
    }
    return adapter;
  }
}
