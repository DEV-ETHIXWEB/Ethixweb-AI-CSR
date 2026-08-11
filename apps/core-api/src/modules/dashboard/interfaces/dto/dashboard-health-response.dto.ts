import { ApiProperty } from "@nestjs/swagger";
import type {
  ComponentHealth,
  DashboardHealth,
} from "../../application/get-dashboard-health.use-case";

export class DashboardHealthResponseDto {
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) database: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) voiceOrchestrator: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) redis: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) hcp: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) telephony: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) stt: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) tts: ComponentHealth;
  @ApiProperty({ enum: ["healthy", "down", "unknown"] }) llm: ComponentHealth;

  private constructor(health: DashboardHealth) {
    this.database = health.database;
    this.voiceOrchestrator = health.voiceOrchestrator;
    this.redis = health.redis;
    this.hcp = health.hcp;
    this.telephony = health.telephony;
    this.stt = health.stt;
    this.tts = health.tts;
    this.llm = health.llm;
  }

  static fromDomain(health: DashboardHealth): DashboardHealthResponseDto {
    return new DashboardHealthResponseDto(health);
  }
}
