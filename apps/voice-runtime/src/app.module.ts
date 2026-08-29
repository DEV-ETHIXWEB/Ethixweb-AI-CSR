import { Module } from "@nestjs/common";
import { resolve } from "node:path";
import { APP_FILTER } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { CallSessionModule } from "./modules/call-session/call-session.module";
import { HealthModule } from "./modules/health/health.module";
import { TelephonyModule } from "./modules/telephony/telephony.module";
import { AppLoggerModule } from "./shared/observability/app-logger.module";
import { validate } from "./shared/config/env.schema";
import { DomainExceptionFilter } from "./shared/http/domain-exception.filter";

/**
 * No global auth guard here, unlike voice-orchestrator's `APP_GUARD:
 * ServiceAuthGuard` — this service has exactly ONE inbound HTTP surface
 * (the Twilio webhook) and it authenticates via TwilioSignatureGuard
 * (route-scoped, `@UseGuards` on TwilioVoiceController) because Twilio can
 * never present this platform's own bearer-token scheme. Everything else
 * this service does is OUTBOUND (calling voice-orchestrator with
 * ORCHESTRATOR_SERVICE_TOKEN, calling Deepgram/ElevenLabs/Twilio's REST
 * API with their own credentials) — there is no second inbound
 * service-to-service caller to gate globally.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Two files, app-specific first — @nestjs/config gives precedence to
      // the earlier entry. `apps/<service>/.env` holds what belongs to THIS
      // service alone (PORT above all: every service previously inherited the
      // root file's single PORT, so booting two of them together bound the
      // same port and the second crashed). The root `.env` holds what is
      // genuinely shared across services (DATABASE_URL, REDIS_URL, the JWT
      // secrets). Both paths are resolved from __dirname, never process.cwd(),
      // so they hold under Docker and `node dist/main.js` regardless of where
      // the process was launched from.
      envFilePath: [resolve(__dirname, "../.env"), resolve(__dirname, "../../../.env")],
      validate,
    }),
    AppLoggerModule,
    HealthModule,
    CallSessionModule,
    TelephonyModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: DomainExceptionFilter }],
})
export class AppModule {}
