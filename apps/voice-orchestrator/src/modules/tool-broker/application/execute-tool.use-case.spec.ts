import { z } from "zod";
import {
  ToolCallInFlightError,
  ToolInputValidationError,
  ToolNotAuthorizedError,
  ToolNotFoundError,
} from "../domain/errors";
import type { ToolDefinition } from "../domain/tool-definition";
import { FakeIdempotencyStore } from "./__fakes__/fake-idempotency-store";
import { FakeToolAuditLog } from "./__fakes__/fake-tool-audit-log";
import { createNoopLogger } from "./__fakes__/fake-logger";
import { FakeToolHandler } from "./__fakes__/fake-tool-handler";
import { ExecuteToolUseCase, type ExecuteToolCommand } from "./execute-tool.use-case";
import { ToolRegistry } from "./tool-registry";

const TEST_TOOL: ToolDefinition = {
  name: "testTool",
  version: "v1",
  description: "a tool for testing",
  inputSchema: z.object({ phone: z.string() }),
  jsonSchema: { type: "object" },
  timeoutMs: 1000,
  retryPolicy: { maxAttempts: 3 },
};

function buildUseCase(
  handler: FakeToolHandler,
  idempotencyStore = new FakeIdempotencyStore(),
  auditLog = new FakeToolAuditLog(),
) {
  const registry = new ToolRegistry();
  registry.register(TEST_TOOL, handler);
  const useCase = new ExecuteToolUseCase(registry, idempotencyStore, auditLog, createNoopLogger());
  return { useCase, registry, idempotencyStore, auditLog };
}

function baseCommand(overrides: Partial<ExecuteToolCommand> = {}): ExecuteToolCommand {
  return {
    tenantId: "tenant-1",
    businessId: "business-1",
    callId: "call-1",
    toolName: "testTool",
    arguments: { phone: "+15551234567" },
    allowedTools: ["testTool"],
    ...overrides,
  };
}

describe("ExecuteToolUseCase", () => {
  it("executes the handler and returns a success result, auditing it", async () => {
    const handler = new FakeToolHandler();
    const { useCase, auditLog } = buildUseCase(handler);

    const result = await useCase.execute(baseCommand());

    expect(result).toMatchObject({ status: "success", output: { ok: true } });
    expect(handler.callCount).toBe(1);
    expect(auditLog.records).toHaveLength(1);
    expect(auditLog.records[0]?.status).toBe("success");
  });

  it("throws ToolNotFoundError for a tool not in the registry — no arbitrary function execution", async () => {
    const handler = new FakeToolHandler();
    const { useCase } = buildUseCase(handler);

    await expect(useCase.execute(baseCommand({ toolName: "nonexistentTool" }))).rejects.toThrow(
      ToolNotFoundError,
    );
    expect(handler.callCount).toBe(0);
  });

  it("rejects malformed input BEFORE execution (stage 1)", async () => {
    const handler = new FakeToolHandler();
    const { useCase } = buildUseCase(handler);

    await expect(useCase.execute(baseCommand({ arguments: { wrongField: 123 } }))).rejects.toThrow(
      ToolInputValidationError,
    );
    expect(handler.callCount).toBe(0);
  });

  it("rejects a tool call outside this agent config's allowlist (stage 2) — never executes", async () => {
    const handler = new FakeToolHandler();
    const { useCase } = buildUseCase(handler);

    await expect(useCase.execute(baseCommand({ allowedTools: ["someOtherTool"] }))).rejects.toThrow(
      ToolNotAuthorizedError,
    );
    expect(handler.callCount).toBe(0);
  });

  it("a completed idempotency key returns the cached result WITHOUT re-executing the handler", async () => {
    const handler = new FakeToolHandler();
    const { useCase } = buildUseCase(handler);
    const command = baseCommand();
    const first = await useCase.execute(command);

    const second = await useCase.execute(command);

    expect(second).toEqual(first);
    expect(handler.callCount).toBe(1);
  });

  it("a different argument hash for the SAME call_id+tool is a genuinely new idempotency key — executes again", async () => {
    const handler = new FakeToolHandler();
    const { useCase } = buildUseCase(handler);

    await useCase.execute(baseCommand({ arguments: { phone: "+15551234567" } }));
    await useCase.execute(baseCommand({ arguments: { phone: "+15559999999" } }));

    expect(handler.callCount).toBe(2);
  });

  it("throws ToolCallInFlightError for a concurrent duplicate call still in flight", async () => {
    const handler = new FakeToolHandler();
    handler.behavior = "hang";
    // A short timeout/single attempt here purely to keep the deliberately
    // "in flight forever" background call from outliving this test (it
    // still won't ever resolve — FakeToolHandler.hang() never settles —
    // but it degrades quickly instead of dangling through several
    // multi-second retry/backoff cycles after the test itself finishes).
    const registry = new ToolRegistry();
    registry.register({ ...TEST_TOOL, timeoutMs: 20, retryPolicy: { maxAttempts: 1 } }, handler);
    const useCase = new ExecuteToolUseCase(
      registry,
      new FakeIdempotencyStore(),
      new FakeToolAuditLog(),
      createNoopLogger(),
    );
    const command = baseCommand();

    // Don't await — leaves the idempotency reservation "in_flight".
    void useCase.execute(command).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(useCase.execute(command)).rejects.toThrow(ToolCallInFlightError);
  });

  it("retries a retryable ToolHandlerError up to the tool's configured maxAttempts, then degrades gracefully", async () => {
    const handler = new FakeToolHandler();
    handler.behavior = "throw-retryable";
    const { useCase, auditLog } = buildUseCase(handler);

    const result = await useCase.execute(baseCommand());

    expect(result.status).toBe("degraded");
    expect(handler.callCount).toBe(TEST_TOOL.retryPolicy.maxAttempts);
    expect(auditLog.records[0]?.status).toBe("degraded");
  });

  it("does NOT retry a non-retryable ToolHandlerError — degrades after exactly one attempt", async () => {
    const handler = new FakeToolHandler();
    handler.behavior = "throw-non-retryable";
    const { useCase } = buildUseCase(handler);

    const result = await useCase.execute(baseCommand());

    expect(result.status).toBe("degraded");
    expect(handler.callCount).toBe(1);
  });

  it("releases the idempotency reservation after a degraded outcome so a real retry isn't permanently blocked", async () => {
    const handler = new FakeToolHandler();
    handler.behavior = "throw-non-retryable";
    const { useCase } = buildUseCase(handler);
    const command = baseCommand();
    await useCase.execute(command);

    // If release() hadn't run, this second call would hang forever behind
    // an "in_flight" reservation that nothing ever completes — instead it
    // re-executes the handler, proving the first failed attempt's
    // reservation was released rather than left permanently stuck.
    await useCase.execute(command);

    expect(handler.callCount).toBe(2);
  });

  it("times out a handler that never resolves within the tool's configured timeoutMs, then degrades", async () => {
    const handler = new FakeToolHandler();
    handler.behavior = "hang";
    const registry = new ToolRegistry();
    registry.register({ ...TEST_TOOL, timeoutMs: 50, retryPolicy: { maxAttempts: 1 } }, handler);
    const useCase = new ExecuteToolUseCase(
      registry,
      new FakeIdempotencyStore(),
      new FakeToolAuditLog(),
      createNoopLogger(),
    );

    const result = await useCase.execute(baseCommand());

    expect(result.status).toBe("degraded");
    if (result.status === "degraded") {
      expect(result.reason).toContain("timed out");
    }
  });
});
