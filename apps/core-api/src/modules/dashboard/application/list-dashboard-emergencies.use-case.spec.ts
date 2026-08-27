import { ListDashboardEmergenciesUseCase } from "./list-dashboard-emergencies.use-case";

describe("ListDashboardEmergenciesUseCase", () => {
  it("returns an empty result — no schema field persists emergency escalations on Lead/Call today (documented gap)", async () => {
    const useCase = new ListDashboardEmergenciesUseCase();

    const result = await useCase.execute("tenant-1", "business-1");

    expect(result).toEqual({ items: [], total: 0 });
  });
});
