import { Inject, Injectable } from "@nestjs/common";
import {
  CircuitBreakerRegistry,
  type RetryPolicyOptions,
  type StructuredLogger,
} from "@ethixweb/shared-kernel";
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

/**
 * Every current caller of `resolve()` is on the SYNCHRONOUS request path of
 * a live phone call (CreateLeadUseCase.attemptCrmSync, CreateCustomerUseCase,
 * SearchCustomerUseCase, VerifyIntegrationUseCase — none of this codebase's
 * CRM-adapter usage is a background/async job; the outbox relay is a
 * separate, unrelated retry mechanism). shared-kernel's platform-wide retry
 * default (6 attempts, 1s/2s/4s/8s/16s backoff ≈ 31s worst case) is correct
 * for that kind of background work and actively wrong here: it directly
 * contradicts CreateLeadUseCase's own documented contract ("never blocks the
 * conversation because the CRM is unreachable") — reproduced live, a single
 * unreachable-CRM createLead call took 32.4s to resolve before falling back
 * to a local-only lead, which is a live caller hearing ~32 seconds of dead
 * air, not "never blocked." 2 attempts / short backoff keeps the worst case
 * around ~1s: one real attempt, one retry for a genuine transient blip, then
 * fall back — matching the "best-effort, never blocks" contract for real.
 */
const CRM_RETRY_OPTIONS: RetryPolicyOptions = {
  maxAttempts: 2,
  baseDelayMs: 250,
  maxDelayMs: 250,
};

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
    return new ResilientCrmAdapter(adapter, circuitBreaker, this.logger, CRM_RETRY_OPTIONS);
  }
}
