import { Controller, Get } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "../../shared/auth/public.decorator";

/**
 * `/healthz` (liveness) and `/readyz` (readiness). Unlike
 * apps/voice-orchestrator's HealthController, readiness here has no
 * external dependency to ping — this service holds no Redis/Postgres
 * connection of its own (STT/TTS sessions are per-call WebSocket
 * connections, not a pooled resource checkable at rest) — so readiness and
 * liveness are currently identical. If a future revision adds a persistent
 * dependency (e.g. Redis for cross-instance call-session state, closing
 * docs/28 §I's gap), readiness should start actually checking it, matching
 * voice-orchestrator's own pattern.
 */
@Public()
@ApiExcludeController()
@Controller()
export class HealthController {
  @Get("healthz")
  liveness(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("readyz")
  readiness(): { status: "ok" } {
    return { status: "ok" };
  }
}
