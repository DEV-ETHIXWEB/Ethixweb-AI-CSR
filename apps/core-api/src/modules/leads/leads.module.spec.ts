import { Test } from "@nestjs/testing";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { RedisModule } from "../../shared/redis/redis.module";
import { APP_LOGGER, AppLoggerModule } from "../../shared/observability/app-logger.module";
import { createNoopLogger } from "./application/__fakes__/fake-logger";
import { LeadsModule } from "./leads.module";
import { LeadsController } from "./interfaces/leads.controller";

const ORIGINAL_ENV = { ...process.env };

/**
 * A DI-graph resolution smoke test — same rationale as
 * customers/customers.module.spec.ts: no unit test here goes through
 * Nest's actual container, so this is the only thing that would catch a
 * wrong DI token or a missing provider across the leads -> crm -> customers
 * -> shared module boundary. `.compile()` never calls `onModuleInit()`, so
 * no real Postgres/Redis connection happens.
 */
describe("LeadsModule (DI wiring smoke test)", () => {
  beforeAll(() => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["REDIS_URL"] = "redis://localhost:6379";
    process.env["JWT_ACCESS_SECRET"] = "test-access-secret";
    process.env["JWT_REFRESH_SECRET"] = "test-refresh-secret";
    process.env["INTEGRATION_CREDENTIALS_MASTER_KEY"] = "a".repeat(64);
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("resolves the entire DI graph (leads -> crm + customers -> shared) with no live DB/Redis connection", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppLoggerModule, PrismaModule, RedisModule, LeadsModule],
    })
      .overrideProvider(APP_LOGGER)
      .useValue(createNoopLogger())
      .compile();

    expect(moduleRef.get(LeadsController)).toBeInstanceOf(LeadsController);

    await moduleRef.close();
  });
});
