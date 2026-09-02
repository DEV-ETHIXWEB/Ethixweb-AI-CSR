import type { StructuredLogger } from "@ethixweb/shared-kernel";

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
