import { Global, Module } from "@nestjs/common";
import { createLogger, type StructuredLogger } from "@ethixweb/shared-kernel";

/** Identical pattern to apps/core-api's own AppLoggerModule — every module injects this, never console.*. */
export const APP_LOGGER = Symbol("APP_LOGGER");

@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useFactory: (): StructuredLogger =>
        createLogger({
          serviceName: "voice-orchestrator",
          pretty: process.env["NODE_ENV"] !== "production",
        }),
    },
  ],
  exports: [APP_LOGGER],
})
export class AppLoggerModule {}
