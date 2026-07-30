import { Global, Module } from "@nestjs/common";
import { createLogger, type StructuredLogger } from "@ethixweb/shared-kernel";

/**
 * DI token for the platform's PII-redacting structured logger
 * (@ethixweb/shared-kernel), per docs/08-security-observability-reliability.md
 * §1.4/§2.1. Every module injects this — never NestJS's built-in `Logger`
 * or raw `console.*` — so every log line goes through the same PII
 * redaction regardless of which module emits it.
 */
export const APP_LOGGER = Symbol("APP_LOGGER");

@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (): StructuredLogger =>
        createLogger({
          serviceName: "core-api",
          pretty: process.env["NODE_ENV"] !== "production",
        }),
    },
  ],
  exports: [APP_LOGGER],
})
export class AppLoggerModule {}
