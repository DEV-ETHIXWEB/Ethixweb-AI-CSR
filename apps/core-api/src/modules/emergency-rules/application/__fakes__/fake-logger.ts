import type { StructuredLogger } from "@ethixweb/shared-kernel";

/** No-op logger for unit tests — asserting on log output belongs in a dedicated logging test, not every use-case spec. */
export function createNoopLogger(): StructuredLogger {
  const logger: StructuredLogger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}
