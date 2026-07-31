import { Test } from "@nestjs/testing";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { RedisModule } from "../../shared/redis/redis.module";
import { APP_LOGGER, AppLoggerModule } from "../../shared/observability/app-logger.module";
import { createNoopLogger } from "./application/__fakes__/fake-logger";
import { CustomersModule } from "./customers.module";
import { CustomersController } from "./interfaces/customers.controller";

const ORIGINAL_ENV = { ...process.env };

/**
 * A DI-graph resolution smoke test — the one thing none of this codebase's
 * unit tests actually exercise, since they all construct classes directly
 * with fakes rather than going through Nest's container. Unit tests can't
 * catch a wrong DI token, a missing provider, or an accidental circular
 * dependency between modules; this can, without needing a live Postgres or
 * Redis connection (`PrismaClient`/`ioredis` don't connect at construction
 * — `RedisService` is explicitly built with `lazyConnect: true` for exactly
 * this reason — and `.compile()`, unlike `.init()`, never invokes
 * `onModuleInit()`, so no real `$connect()`/`.connect()` call ever happens
 * here). This is specifically what proves the customers↔crm module
 * boundary (CustomersModule importing CrmModule for CRM_CUSTOMER_SYNC_PORT)
 * is wired correctly, not just that it reads correctly.
 */
describe("CustomersModule (DI wiring smoke test)", () => {
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

  it("resolves the entire DI graph (customers -> crm -> shared) with no live DB/Redis connection", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppLoggerModule, PrismaModule, RedisModule, CustomersModule],
    })
      // AppLoggerModule's real factory builds a pino instance with a
      // pretty-print worker-thread transport outside production — a real,
      // known friction point running INSIDE Jest's own worker processes,
      // unrelated to whether this module's DI graph is wired correctly
      // (which is the only thing this test cares about). Overridden with a
      // no-op rather than pulled in for real, the same as every other unit
      // test in this codebase fakes APP_LOGGER.
      .overrideProvider(APP_LOGGER)
      .useValue(createNoopLogger())
      .compile();

    expect(moduleRef.get(CustomersController)).toBeInstanceOf(CustomersController);

    await moduleRef.close();
  });
});
