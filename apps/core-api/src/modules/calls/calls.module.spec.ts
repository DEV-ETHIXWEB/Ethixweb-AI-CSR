import { Test } from "@nestjs/testing";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { RedisModule } from "../../shared/redis/redis.module";
import { APP_LOGGER, AppLoggerModule } from "../../shared/observability/app-logger.module";
import { createNoopLogger } from "./application/__fakes__/fake-logger";
import { CallsModule } from "./calls.module";
import { CallsToolController } from "./interfaces/calls-tool.controller";

const ORIGINAL_ENV = { ...process.env };

/**
 * A DI-graph resolution smoke test — see CustomersModule's own spec for the
 * full reasoning (unit tests construct classes directly with fakes and
 * never exercise Nest's actual container). Proves CallsToolController and
 * PrismaCallRepository resolve correctly with no live DB/Redis connection.
 */
describe("CallsModule (DI wiring smoke test)", () => {
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

  it("resolves the entire DI graph (calls -> shared) with no live DB/Redis connection", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppLoggerModule, PrismaModule, RedisModule, CallsModule],
    })
      .overrideProvider(APP_LOGGER)
      .useValue(createNoopLogger())
      .compile();

    expect(moduleRef.get(CallsToolController)).toBeInstanceOf(CallsToolController);

    await moduleRef.close();
  });
});
