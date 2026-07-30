import { describe, expect, it, vi } from "vitest";
import { relayOutboxBatch, type OutboxRecord } from "../src/outbox/outbox";

function record(overrides: Partial<OutboxRecord> = {}): OutboxRecord {
  return {
    id: "evt-1",
    aggregateType: "Lead",
    aggregateId: "lead-1",
    eventType: "lead.created",
    payload: {},
    createdAt: new Date(),
    ...overrides,
  };
}

describe("relayOutboxBatch", () => {
  it("publishes and marks dispatched every pending record", async () => {
    const records = [record({ id: "evt-1" }), record({ id: "evt-2" })];
    const publish = vi.fn().mockResolvedValue(undefined);
    const markDispatched = vi.fn().mockResolvedValue(undefined);

    const result = await relayOutboxBatch({
      fetchPendingBatch: async () => records,
      publish,
      markDispatched,
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(markDispatched).toHaveBeenNthCalledWith(1, "evt-1");
    expect(markDispatched).toHaveBeenNthCalledWith(2, "evt-2");
    expect(result).toEqual({ processed: 2, dispatched: 2, failed: 0 });
  });

  it("continues processing remaining records when one publish fails, and reports it via onError", async () => {
    const records = [record({ id: "evt-1" }), record({ id: "evt-2" })];
    const publish = vi.fn().mockImplementation(async (r: OutboxRecord) => {
      if (r.id === "evt-1") throw new Error("broker unavailable");
    });
    const markDispatched = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const result = await relayOutboxBatch({
      fetchPendingBatch: async () => records,
      publish,
      markDispatched,
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].id).toBe("evt-1");
    expect(markDispatched).toHaveBeenCalledTimes(1);
    expect(markDispatched).toHaveBeenCalledWith("evt-2");
    expect(result).toEqual({ processed: 2, dispatched: 1, failed: 1 });
  });

  it("respects the requested batch size when fetching pending records", async () => {
    const fetchPendingBatch = vi.fn().mockResolvedValue([]);
    await relayOutboxBatch({ fetchPendingBatch, publish: vi.fn(), markDispatched: vi.fn() }, 25);
    expect(fetchPendingBatch).toHaveBeenCalledWith(25);
  });
});
