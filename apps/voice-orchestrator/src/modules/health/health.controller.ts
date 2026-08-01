import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../shared/auth/public.decorator";
import { RedisService } from "../../shared/redis/redis.service";

/**
 * `/healthz` (liveness) and `/readyz` (readiness — Redis connectivity only;
 * this service has no Postgres dependency, see RedisService's own comment).
 * `@Public()` for the same reason as apps/core-api's HealthController: ECS
 * health-check probes carry no credentials.
 */
@Public()
@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(private readonly redis: RedisService) {}

  @Get("healthz")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  async readiness(): Promise<{ status: "ok"; redis: "up" }> {
    try {
      await this.redis.ping();
      return { status: "ok", redis: "up" };
    } catch (error) {
      throw new HttpException(
        { status: "error", redis: "down", message: (error as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
