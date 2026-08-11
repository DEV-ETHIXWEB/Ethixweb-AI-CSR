import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../shared/prisma/prisma.service";

export type ComponentHealth = "healthy" | "down" | "unknown";

export interface DashboardHealth {
  database: ComponentHealth;
  voiceOrchestrator: ComponentHealth;
  redis: ComponentHealth;
  hcp: ComponentHealth;
  telephony: ComponentHealth;
  stt: ComponentHealth;
  tts: ComponentHealth;
  llm: ComponentHealth;
}

/**
 * `database` is the only component this use case can genuinely observe —
 * a real `SELECT 1` against core-api's own Postgres connection. Every
 * other component is reported `"unknown"` deliberately: core-api has no
 * outbound connection to voice-orchestrator, Redis, Housecall Pro,
 * telephony, STT, TTS, or LLM providers FROM ITSELF (voice-orchestrator
 * owns those integrations, not core-api — see docs/01-architecture-overview.md's
 * service boundary), and this use case does NOT add one just to populate
 * a health field. Adding a new outbound HTTP call from core-api to
 * voice-orchestrator (or any provider) purely to answer a dashboard health
 * check would be new cross-service coupling introduced as a side effect of
 * this task, not something requested — "unknown" is the honest answer,
 * not a fabricated "healthy".
 */
@Injectable()
export class GetDashboardHealthUseCase {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<DashboardHealth> {
    let database: ComponentHealth = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = "healthy";
    } catch {
      database = "down";
    }

    return {
      database,
      voiceOrchestrator: "unknown",
      redis: "unknown",
      hcp: "unknown",
      telephony: "unknown",
      stt: "unknown",
      tts: "unknown",
      llm: "unknown",
    };
  }
}
