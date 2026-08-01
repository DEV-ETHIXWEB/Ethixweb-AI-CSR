import type { z } from "zod";

export interface ToolRetryPolicy {
  /** Total attempts including the first — matches shared-kernel's withRetry `maxAttempts` semantics. */
  maxAttempts: number;
}

/**
 * A tool's static, versioned definition — docs/04-ai-tool-architecture.md
 * §3's per-tool table translated into code. `inputSchema` is the actual
 * runtime validator (stage 1 of the broker pipeline, docs/04 §2: "Zod,
 * strict, no passthrough"); `jsonSchema` is the equivalent shape handed to
 * the AI provider's own function-calling schema — kept as a separate,
 * hand-maintained field rather than derived from the Zod schema, since
 * Zod has no built-in JSON-Schema exporter and pulling in a
 * zod-to-json-schema dependency for one mechanical conversion isn't
 * warranted yet.
 */
export interface ToolDefinition<Input = unknown> {
  name: string;
  version: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  jsonSchema: Record<string, unknown>;
  timeoutMs: number;
  retryPolicy: ToolRetryPolicy;
}

/** Thrown by a ToolHandler — `retryable` drives the broker's retry policy (docs/04 §3.2: "never retries on 4xx validation errors"). */
export class ToolHandlerError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ToolHandlerError";
  }
}

export interface ToolHandlerContext {
  tenantId: string;
  businessId: string;
  callId: string;
}

export interface ToolHandler<Input = unknown, Output = unknown> {
  execute(input: Input, context: ToolHandlerContext): Promise<Output>;
}
