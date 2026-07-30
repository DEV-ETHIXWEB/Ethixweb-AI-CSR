import pino, { type Logger as PinoLogger } from "pino";

/**
 * PII-redacting structured logger, per docs/08-security-observability-reliability.md §1.4/§2.1.
 * Context fields (tenantId, callId, conversationTurnId) are attached via
 * `.child()` so every log line from a request/call is correlated, matching
 * docs/01-architecture-overview.md §1 rule 7.
 */
export interface LoggerContext {
  tenantId?: string;
  businessId?: string;
  callId?: string;
  conversationTurnId?: string;
  [key: string]: unknown;
}

export interface StructuredLogger {
  child(context: LoggerContext): StructuredLogger;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface CreateLoggerOptions {
  serviceName: string;
  level?: string;
  /** Additional pino redaction paths beyond the platform-wide PII defaults. */
  redactPaths?: string[];
  pretty?: boolean;
}

/** Field-name patterns redacted on every logger by default — extend, don't replace, per app. */
const DEFAULT_REDACT_PATHS = [
  "*.phone",
  "*.phoneE164",
  "*.phone_e164",
  "*.email",
  "*.address",
  "*.name",
  "*.customerName",
  "*.creditCard",
  "*.ssn",
  "req.headers.authorization",
  "req.headers.cookie",
];

class PinoStructuredLogger implements StructuredLogger {
  constructor(private readonly pinoInstance: PinoLogger) {}

  child(context: LoggerContext): StructuredLogger {
    return new PinoStructuredLogger(this.pinoInstance.child(context));
  }

  debug(message: string, meta: Record<string, unknown> = {}): void {
    this.pinoInstance.debug(meta, message);
  }

  info(message: string, meta: Record<string, unknown> = {}): void {
    this.pinoInstance.info(meta, message);
  }

  warn(message: string, meta: Record<string, unknown> = {}): void {
    this.pinoInstance.warn(meta, message);
  }

  error(message: string, meta: Record<string, unknown> = {}): void {
    this.pinoInstance.error(meta, message);
  }
}

export function createLogger(options: CreateLoggerOptions): StructuredLogger {
  const instance = pino({
    name: options.serviceName,
    level: options.level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: {
      paths: [...DEFAULT_REDACT_PATHS, ...(options.redactPaths ?? [])],
      censor: "[REDACTED]",
    },
    ...(options.pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  });
  return new PinoStructuredLogger(instance);
}

/** Test/dev-only constructor that wraps an already-configured pino instance (e.g. writing to a capture stream). */
export function wrapPinoInstance(instance: PinoLogger): StructuredLogger {
  return new PinoStructuredLogger(instance);
}
