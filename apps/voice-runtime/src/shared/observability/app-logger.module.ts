import { Global, Module } from "@nestjs/common";
import { createLogger, type StructuredLogger } from "@ethixweb/shared-kernel";

/** Identical pattern to apps/voice-orchestrator's own AppLoggerModule — every module injects this, never console.*. */
export const APP_LOGGER = Symbol("APP_LOGGER");

@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (): StructuredLogger =>
        createLogger({
          serviceName: "voice-runtime",
          pretty: process.env["NODE_ENV"] !== "production",
          // Twilio's own StreamSid/CallSid and Deepgram/ElevenLabs session
          // ids are opaque identifiers, not PII — no additional redaction
          // paths needed beyond structured-logger.ts's platform-wide
          // defaults (phone/email/address/name already covered there).
        }),
    },
  ],
  exports: [APP_LOGGER],
})
export class AppLoggerModule {}
