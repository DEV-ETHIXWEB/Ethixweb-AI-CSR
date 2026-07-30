import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckError,
  type HealthCheckResult,
  type HealthIndicatorResult,
  PrismaHealthIndicator,
} from "@nestjs/terminus";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../shared/auth/public.decorator";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { RedisService } from "../../shared/redis/redis.service";

/**
 * `/healthz` (liveness) and `/readyz` (readiness — checks DB + Redis
 * connectivity), per docs/08-security-observability-reliability.md §2.4.
 * Excluded from the `/v1` global prefix in main.ts and from the OpenAPI
 * document — these are infra probes, not part of the public API surface.
 * `@Public()`: load-balancer/ECS health checks carry no credentials —
 * without this, the now-global AuthGuard (auth.module.ts) would 401 every
 * health check and the service would never pass readiness.
 */
@Public()
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get("healthz")
  @HealthCheck()
  liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get("readyz")
  @HealthCheck()
  readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.prismaHealth.pingCheck("database", this.prisma),
      () => this.checkRedis(),
    ]);
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return { redis: { status: "up" } };
    } catch (error) {
      throw new HealthCheckError("Redis check failed", {
        redis: { status: "down", message: (error as Error).message },
      });
    }
  }
}
