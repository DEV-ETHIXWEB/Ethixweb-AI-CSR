import { Inject, Injectable } from "@nestjs/common";
import { CircuitBreakerRegistry, type StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { UnknownCrmTypeError } from "../domain/errors";
import type { CRMAdapter } from "../domain/ports/crm-adapter.port";
import type { CrmAdapterRegistry } from "../domain/ports/crm-adapter-registry.port";
import { CIRCUIT_BREAKER_REGISTRY } from "./circuit-breaker-registry.token";
import { FieldEdgeAdapter } from "./adapters/field-edge.adapter";
import { HousecallProAdapter } from "./adapters/housecall-pro.adapter";
import { JobberAdapter } from "./adapters/jobber.adapter";
import { ResilientCrmAdapter } from "./resilient-crm-adapter";
import { ServiceFusionAdapter } from "./adapters/service-fusion.adapter";
import { ServiceTitanAdapter } from "./adapters/service-titan.adapter";

@Injectable()
export class CrmAdapterRegistryImpl implements CrmAdapterRegistry {
  private readonly adapters: ReadonlyMap<string, CRMAdapter>;

  constructor(
    housecallPro: HousecallProAdapter,
    serviceTitan: ServiceTitanAdapter,
    jobber: JobberAdapter,
    serviceFusion: ServiceFusionAdapter,
    fieldEdge: FieldEdgeAdapter,
    @Inject(CIRCUIT_BREAKER_REGISTRY) private readonly circuitBreakers: CircuitBreakerRegistry,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {
    this.adapters = new Map<string, CRMAdapter>([
      [housecallPro.crmType, housecallPro],
      [serviceTitan.crmType, serviceTitan],
      [jobber.crmType, jobber],
      [serviceFusion.crmType, serviceFusion],
      [fieldEdge.crmType, fieldEdge],
    ]);
  }

  resolve(crmType: string, tenantId: string): CRMAdapter {
    const adapter = this.adapters.get(crmType);
    if (!adapter) {
      throw new UnknownCrmTypeError(crmType);
    }
    // Keyed per (crmType, tenant) — see the port's own comment on why a
    // shared-per-CRM breaker would let one tenant's bad credential trip
    // the circuit for every other tenant on the same CRM vendor.
    const circuitBreaker = this.circuitBreakers.getOrCreate(`crm:${crmType}:${tenantId}`);
    return new ResilientCrmAdapter(adapter, circuitBreaker, this.logger);
  }
}
