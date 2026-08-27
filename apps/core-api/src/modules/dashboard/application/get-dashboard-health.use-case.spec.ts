import { GetDashboardHealthUseCase } from "./get-dashboard-health.use-case";

function buildUseCase(queryRaw: () => Promise<unknown>) {
  const fakePrisma = { $queryRaw: () => queryRaw() };
  return new GetDashboardHealthUseCase(fakePrisma as never);
}

describe("GetDashboardHealthUseCase", () => {
  it("reports database: healthy when SELECT 1 succeeds", async () => {
    const useCase = buildUseCase(() => Promise.resolve([{ "?column?": 1 }]));

    const health = await useCase.execute();

    expect(health.database).toBe("healthy");
  });

  it("reports database: down when SELECT 1 throws", async () => {
    const useCase = buildUseCase(() => Promise.reject(new Error("connection refused")));

    const health = await useCase.execute();

    expect(health.database).toBe("down");
  });

  it("reports every other component as unknown — core-api has no outbound check for these", async () => {
    const useCase = buildUseCase(() => Promise.resolve([{ "?column?": 1 }]));

    const health = await useCase.execute();

    expect(health.voiceOrchestrator).toBe("unknown");
    expect(health.redis).toBe("unknown");
    expect(health.hcp).toBe("unknown");
    expect(health.telephony).toBe("unknown");
    expect(health.stt).toBe("unknown");
    expect(health.tts).toBe("unknown");
    expect(health.llm).toBe("unknown");
  });
});
