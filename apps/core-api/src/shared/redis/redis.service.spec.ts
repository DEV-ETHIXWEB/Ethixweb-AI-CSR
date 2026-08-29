import { RedisService } from "./redis.service";

/**
 * Regression coverage for a real bug found live: with REDIS_URL pointed
 * at an unreachable host, this service's bootstrap hung for ioredis's
 * default 10s connectTimeout, then crashed with a raw, undiagnosable
 * "Fatal error during bootstrap: Connection is closed" stack trace and no
 * indication Redis was the actual problem. Fixed with an explicit,
 * shorter connectTimeout (matching the already-tuned commandTimeout) and
 * a try/catch around connect() that logs a clear, actionable message
 * before re-throwing (this service genuinely cannot run without Redis, so
 * failing bootstrap is still correct, it just needed to be diagnosable
 * and fast). These tests never make a real network call: connect() is
 * stubbed on the constructed instance before onModuleInit runs.
 */
describe("RedisService", () => {
  const originalEnv = process.env["REDIS_URL"];

  beforeEach(() => {
    process.env["REDIS_URL"] = "redis://localhost:6379";
  });

  afterEach(() => {
    process.env["REDIS_URL"] = originalEnv;
    jest.restoreAllMocks();
  });

  it("throws immediately if REDIS_URL is not set, before ever touching the network", () => {
    delete process.env["REDIS_URL"];
    expect(() => new RedisService()).toThrow("REDIS_URL is not set.");
  });

  it("bounds both the initial connection and ongoing commands to 3s, not ioredis's own much longer defaults", () => {
    const service = new RedisService();
    try {
      expect(service.options.connectTimeout).toBe(3000);
      expect(service.options.commandTimeout).toBe(3000);
      expect(service.options.maxRetriesPerRequest).toBe(3);
    } finally {
      service.disconnect();
    }
  });

  it("onModuleInit logs a clear, actionable error and re-throws when the initial connection fails, rather than surfacing only a raw ioredis stack trace", async () => {
    const service = new RedisService();
    const connectError = new Error("connect ETIMEDOUT");
    jest.spyOn(service, "connect").mockRejectedValue(connectError);
    const errorSpy = jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);

    await expect(service.onModuleInit()).rejects.toThrow(connectError);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to connect to Redis"));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("connect ETIMEDOUT"));
  });

  it("onModuleInit resolves cleanly and logs success when connect() succeeds", async () => {
    const service = new RedisService();
    jest.spyOn(service, "connect").mockResolvedValue(undefined);
    const logSpy = jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith("Connected to Redis");
  });
});
