import { Writable } from "node:stream";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { wrapPinoInstance } from "../src/logging/structured-logger";

function createCaptureStream(lines: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
}

describe("structured logger PII redaction", () => {
  it("redacts a nested phone field before it reaches the log sink", () => {
    const lines: string[] = [];
    const pinoInstance = pino(
      {
        redact: { paths: ["customer.phone"], censor: "[REDACTED]" },
      },
      createCaptureStream(lines),
    );
    const logger = wrapPinoInstance(pinoInstance);

    logger.info("lead qualified", { customer: { phone: "+15551234567", name: "Jane" } });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] as string) as { customer: { phone: string; name: string } };
    expect(parsed.customer.phone).toBe("[REDACTED]");
    expect(parsed.customer.name).toBe("Jane");
  });

  it("attaches child context fields (tenantId, callId) to every subsequent log line", () => {
    const lines: string[] = [];
    const pinoInstance = pino({}, createCaptureStream(lines));
    const logger = wrapPinoInstance(pinoInstance);

    const callLogger = logger.child({ tenantId: "tenant-1", callId: "call-1" });
    callLogger.info("call started");
    callLogger.info("lead created");

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { tenantId: string; callId: string };
      expect(parsed.tenantId).toBe("tenant-1");
      expect(parsed.callId).toBe("call-1");
    }
  });
});
