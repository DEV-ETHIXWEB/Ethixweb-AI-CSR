import { randomUUID } from "node:crypto";
import type { CallAdmissionPort } from "../../../capacity/domain/call-admission.port";
import { CapacityExceededError } from "../../../capacity/domain/errors";

/** In-memory mirror of RedisCallAdmissionAdapter's admission logic, for tests that don't need real Redis. */
export class FakeCallAdmissionPort implements CallAdmissionPort {
  private readonly tenantActive = new Map<string, number>();
  private globalActive = 0;
  private readonly reservations = new Set<string>();

  /** Test control: force the next reserve() to fail as if capacity were exhausted. */
  forceExhausted: "tenant" | "global" | null = null;

  async reserve(
    tenantId: string,
    _businessId: string,
    limits: {
      maxTenantConcurrentCalls: number;
      maxGlobalConcurrentCalls: number;
      emergencyHeadroomRatio: number;
      isEmergencyPriority: boolean;
    },
  ): Promise<{ reservationId: string }> {
    if (this.forceExhausted === "tenant") {
      throw new CapacityExceededError(tenantId, "tenant");
    }
    if (this.forceExhausted === "global") {
      throw new CapacityExceededError(tenantId, "global");
    }
    const tenantCeiling = limits.isEmergencyPriority
      ? limits.maxTenantConcurrentCalls
      : Math.max(
          1,
          Math.floor(limits.maxTenantConcurrentCalls * (1 - limits.emergencyHeadroomRatio)),
        );
    const tenantCount = this.tenantActive.get(tenantId) ?? 0;
    if (tenantCount >= tenantCeiling) {
      throw new CapacityExceededError(tenantId, "tenant");
    }
    if (this.globalActive >= limits.maxGlobalConcurrentCalls) {
      throw new CapacityExceededError(tenantId, "global");
    }
    this.tenantActive.set(tenantId, tenantCount + 1);
    this.globalActive += 1;
    const reservationId = randomUUID();
    this.reservations.add(`${tenantId}:${reservationId}`);
    return { reservationId };
  }

  async release(tenantId: string, reservationId: string): Promise<void> {
    const key = `${tenantId}:${reservationId}`;
    if (!this.reservations.has(key)) {
      return;
    }
    this.reservations.delete(key);
    const tenantCount = this.tenantActive.get(tenantId) ?? 0;
    if (tenantCount > 0) {
      this.tenantActive.set(tenantId, tenantCount - 1);
    }
    if (this.globalActive > 0) {
      this.globalActive -= 1;
    }
  }

  async getActiveCounts(tenantId: string): Promise<{ tenantActive: number; globalActive: number }> {
    return { tenantActive: this.tenantActive.get(tenantId) ?? 0, globalActive: this.globalActive };
  }
}
