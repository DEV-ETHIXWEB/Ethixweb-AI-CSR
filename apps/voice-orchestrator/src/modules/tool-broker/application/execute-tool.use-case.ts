import { Inject, Injectable } from "@nestjs/common";
import type { IdempotencyStore, StructuredLogger } from "@ethixweb/shared-kernel";
import { RetryExhaustedError, withRetry } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { IDEMPOTENCY_STORE } from "../../../shared/idempotency/idempotency-store.token";
import {
  ToolCallInFlightError,
  ToolInputValidationError,
  ToolNotAuthorizedError,
  ToolNotFoundError,
} from "../domain/errors";
import { ToolHandlerError } from "../domain/tool-definition";
import { TOOL_AUDIT_LOG, type ToolAuditLogPort } from "../domain/ports/tool-audit-log.port";
import { ToolRegistry } from "./tool-registry";
import { hashArgs } from "./util/hash-args";
import { withTimeout } from "./util/with-timeout";

export interface ExecuteToolCommand {
  tenantId: string;
  businessId: string;
  callId: string;
  toolName: string;
  arguments: unknown;
  /** docs/04 §2 stage 2 — this agent config's tool allowlist. */
  allowedTools: readonly string[];
}

export type ToolExecutionResult =
  | { status: "success"; output: unknown; durationMs: number }
  | { status: "degraded"; reason: string; durationMs: number };

/**
 * The full six-stage pipeline from docs/04-ai-tool-architecture.md §2:
 * validation → authorization → idempotency → timeout → execute → audit.
 * "No arbitrary function execution. The AI may only execute registered
 * tools" is enforced structurally here, not by convention: stage 1 fails
 * closed on anything not in {@link ToolRegistry}, stage 2 fails closed on
 * anything not schema-valid, stage 3 fails closed on anything outside this
 * specific agent config's allowlist.
 */
@Injectable()
export class ExecuteToolUseCase {
  constructor(
    private readonly registry: ToolRegistry,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStore,
    @Inject(TOOL_AUDIT_LOG) private readonly auditLog: ToolAuditLogPort,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: ExecuteToolCommand): Promise<ToolExecutionResult> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.tool_name": command.toolName,
    });

    // Stage 1: registry lookup.
    const registered = this.registry.get(command.toolName);
    if (!registered) {
      throw new ToolNotFoundError(command.toolName);
    }
    const { definition, handler } = registered;

    // Stage 2: schema validation — strict, no passthrough (docs/04 §2 stage 1).
    // Identity arguments are supplied by THIS use case, never by the model:
    // see withAuthoritativeIdentity below.
    const parsed = definition.inputSchema.safeParse(
      withAuthoritativeIdentity(command, definition.jsonSchema),
    );
    if (!parsed.success) {
      throw new ToolInputValidationError(command.toolName, formatZodIssues(parsed.error));
    }

    // Stage 3: authorization against this agent config's allowlist.
    if (!command.allowedTools.includes(command.toolName)) {
      throw new ToolNotAuthorizedError(command.toolName);
    }

    // Stage 4 setup: idempotency key = call_id + tool_name + arg_hash (docs/04 §2 stage 3).
    const idempotencyKey = `tool:${command.callId}:${command.toolName}:${hashArgs(parsed.data)}`;
    const outcome = await this.idempotencyStore.begin<ToolExecutionResult>(idempotencyKey, {
      ttlSeconds: 3600,
    });
    if (outcome.status === "completed") {
      return outcome.result;
    }
    if (outcome.status === "in_flight") {
      throw new ToolCallInFlightError(idempotencyKey);
    }

    const startedAt = Date.now();
    try {
      // Stages 4-5: timeout wrapper + execute, retried per the tool's own policy.
      const output = await withRetry(
        () =>
          withTimeout(
            () =>
              handler.execute(parsed.data, {
                tenantId: command.tenantId,
                businessId: command.businessId,
                callId: command.callId,
              }),
            definition.timeoutMs,
          ),
        {
          maxAttempts: definition.retryPolicy.maxAttempts,
          isRetryable: (error) => (error instanceof ToolHandlerError ? error.retryable : true),
        },
      );

      const durationMs = Date.now() - startedAt;
      const result: ToolExecutionResult = { status: "success", output, durationMs };
      await this.idempotencyStore.complete(idempotencyKey, result, { ttlSeconds: 3600 });
      // Stage 6: audit write.
      await this.auditLog.record({
        tenantId: command.tenantId,
        callId: command.callId,
        toolName: command.toolName,
        input: parsed.data,
        output,
        status: "success",
        durationMs,
        idempotencyKey,
        createdAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      // Retry exhausted (or non-retryable) — release the reservation so a
      // legitimate future retry with the SAME args isn't permanently
      // blocked, and degrade gracefully rather than crashing the call
      // (docs/04 §2: "Graceful degraded response to LLM").
      await this.idempotencyStore.release(idempotencyKey);
      const durationMs = Date.now() - startedAt;
      const reason = extractReason(error);
      await this.auditLog.record({
        tenantId: command.tenantId,
        callId: command.callId,
        toolName: command.toolName,
        input: parsed.data,
        status: "degraded",
        durationMs,
        idempotencyKey,
        errorMessage: reason,
        createdAt: new Date().toISOString(),
      });
      this.logger.warn("tool execution degraded", {
        tenantId: command.tenantId,
        toolName: command.toolName,
        reason,
      });
      return { status: "degraded", reason, durationMs };
    }
  }
}

/**
 * `business_id` and `call_id` are facts about the call, not decisions the
 * model gets to make — but every tool schema requires them and nothing in
 * the prompt ever told the model what they are (RUNTIME CONTEXT carries the
 * time, business hours and caller ANI, and stops there). So the model had
 * no option but to invent a value, schema validation rejected it as a
 * malformed uuid, and EVERY tool call failed — createLead, searchCustomer,
 * escalateEmergency alike. Found by running a real conversation against a
 * live LLM: the model reached for `escalateEmergency` correctly and was
 * refused on `business_id: Invalid uuid; call_id: Invalid uuid`.
 *
 * Overwriting rather than defaulting is deliberate, and it is the security
 * property as much as the fix: these values scope tenant isolation, so a
 * model that could set them — whether by mistake or because a caller talked
 * it into doing so — could aim a tool at another tenant's business. The
 * caller-supplied command is the only trustworthy source, so it always
 * wins.
 *
 * Only keys the tool actually declares are injected, so a tool that takes
 * neither is left untouched and still fails closed on a genuinely bad
 * argument.
 */
function withAuthoritativeIdentity(
  command: ExecuteToolCommand,
  jsonSchema: Record<string, unknown>,
): unknown {
  const properties = (jsonSchema as { properties?: Record<string, unknown> }).properties;
  if (!properties) {
    return command.arguments;
  }
  const args =
    typeof command.arguments === "object" && command.arguments !== null
      ? { ...(command.arguments as Record<string, unknown>) }
      : {};
  if ("business_id" in properties) {
    args["business_id"] = command.businessId;
  }
  if ("call_id" in properties) {
    args["call_id"] = command.callId;
  }
  return args;
}

function formatZodIssues(error: {
  issues: Array<{ path: (string | number)[]; message: string }>;
}): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Unwraps RetryExhaustedError's `lastError` so the degraded reason surfaces the actual root cause (e.g. "Tool call timed out after 50ms") rather than the generic "Retry exhausted after N attempt(s)" wrapper message. */
function extractReason(error: unknown): string {
  if (error instanceof RetryExhaustedError) {
    return extractReason(error.lastError);
  }
  return error instanceof Error ? error.message : String(error);
}
