import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coreApiUrl } from "./core-api-url";

describe("coreApiUrl", () => {
  const originalEnv = process.env["CORE_API_BASE_URL"];

  beforeEach(() => {
    delete process.env["CORE_API_BASE_URL"];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["CORE_API_BASE_URL"];
    } else {
      process.env["CORE_API_BASE_URL"] = originalEnv;
    }
  });

  it("defaults to localhost:3000 with the v1 prefix core-api's main.ts actually sets", () => {
    expect(coreApiUrl("/auth/login")).toBe("http://localhost:3000/v1/auth/login");
  });

  it("respects CORE_API_BASE_URL when set, still applying the v1 prefix", () => {
    process.env["CORE_API_BASE_URL"] = "https://core-api.internal";
    expect(coreApiUrl("/dashboard/overview")).toBe(
      "https://core-api.internal/v1/dashboard/overview",
    );
  });
});
