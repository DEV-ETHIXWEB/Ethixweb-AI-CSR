import type { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { createNoopLogger } from "../__fakes__/fake-logger";
import { FakeApiKeyRepository } from "../__fakes__/fake-api-key-repository";
import { FakeTenantContextService } from "../__fakes__/fake-tenant-context";
import { CreateApiKeyUseCase } from "../commands/create-api-key.use-case";
import { ListApiKeysUseCase } from "./list-api-keys.use-case";

describe("ListApiKeysUseCase", () => {
  it("only returns keys belonging to the requested tenant", async () => {
    const apiKeyRepository = new FakeApiKeyRepository();
    const tenantContext = new FakeTenantContextService() as unknown as TenantContextService;
    const createUseCase = new CreateApiKeyUseCase(
      tenantContext,
      apiKeyRepository,
      createNoopLogger(),
    );
    await createUseCase.execute({ tenantId: "tenant-1", scopes: "full", expiresAt: null });
    await createUseCase.execute({ tenantId: "tenant-2", scopes: "read_only", expiresAt: null });

    const listUseCase = new ListApiKeysUseCase(tenantContext, apiKeyRepository);
    const keys = await listUseCase.execute("tenant-1");

    expect(keys).toHaveLength(1);
    expect(keys[0]?.tenantId).toBe("tenant-1");
  });
});
