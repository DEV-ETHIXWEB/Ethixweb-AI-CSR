import IoRedisMock from "ioredis-mock";

// `AppModule`'s `ConfigModule.forRoot({ validate })` (app.module.ts) runs
// `envSchema.safeParse(process.env)` at CLASS-DEFINITION time — i.e. the
// instant this file's `import { AppModule } from "../src/app.module"`
// below is evaluated, which happens before any of THIS file's own function
// bodies run. These vars must exist in `process.env` before that static
// import line, not inside `bootVoiceRuntimeSimulator()` — setting them
// there is too late and fails boot with "Invalid environment
// configuration" (the exact failure mode Phase 8's own env.schema.ts gap
// fix was built to surface, just one line too early for a naive fixture).
process.env["ORCHESTRATOR_SERVICE_TOKEN"] ??= "sim-service-token";
process.env["CORE_API_BASE_URL"] ??= "http://core-api.invalid";
process.env["CORE_API_SERVICE_API_KEY"] ??= "sim-core-api-key";
process.env["REDIS_URL"] ??= "redis://sim-invalid:6379";

import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { InMemoryIdempotencyStore } from "@ethixweb/shared-kernel";
import { AppModule } from "../src/app.module";
import { APP_LOGGER } from "../src/shared/observability/app-logger.module";
import { RedisService } from "../src/shared/redis/redis.service";
import { IDEMPOTENCY_STORE } from "../src/shared/idempotency/idempotency-store.token";
import {
  AI_PROVIDER_ROUTER,
  type AiProviderPort,
} from "../src/modules/ai-provider/domain/ai-provider.port";
import { CORE_API_CLIENT } from "../src/modules/tool-broker/domain/ports/core-api-client.port";
import { FakeAiProvider } from "../src/modules/conversation/application/__fakes__/fake-ai-provider";
import { FakeCoreApiClient } from "../src/modules/tool-broker/application/__fakes__/fake-core-api-client";
import { createNoopLogger } from "../src/modules/conversation/application/__fakes__/fake-logger";

/**
 * Drives the REAL Nest module graph — real controllers, real
 * `ServiceAuthGuard`, real `ValidationPipe`, real use cases, real
 * `TransitionConversationStateUseCase` state machine, real
 * `ExecuteToolUseCase` six-stage pipeline — over real HTTP via Fastify's
 * own `.inject()` (no network socket, but the full Fastify request/response
 * lifecycle, unlike calling a controller method directly). This is what
 * lets these tests function as a genuine Voice Runtime STAND-IN: anything
 * that would break integrating a real runtime against this service's HTTP
 * contract should break one of these tests first.
 *
 * The only three things overridden are true external I/O this environment
 * has no live access to, matching every other "no live sandbox" caveat in
 * this codebase: `RedisService` (→ `ioredis-mock`, the SAME substitution
 * `redis-conversation.repository.spec.ts` already uses — not a new
 * pattern), the AI provider router (→ `FakeAiProvider`, scriptable
 * per-call responses), and the core-api HTTP client (→ `FakeCoreApiClient`,
 * scriptable per-path responses). Everything else — auth, validation,
 * idempotency, the conversation state machine, the tool broker's
 * validation/authorization/idempotency/audit stages — is the real code.
 */
export interface VoiceRuntimeSimulator {
  app: NestFastifyApplication;
  aiProvider: FakeAiProvider;
  coreApiClient: FakeCoreApiClient;
  /** Raw Fastify inject — use when a test needs the actual HTTP status/headers rather than a parsed body. */
  inject: NestFastifyApplication["inject"];
  serviceToken: string;
  close(): Promise<void>;
}

const SERVICE_TOKEN = process.env["ORCHESTRATOR_SERVICE_TOKEN"];
if (!SERVICE_TOKEN) {
  // Unreachable in practice — the `??=` assignment above this file's own
  // imports guarantees it — but a real `string` (not `string | undefined`)
  // is worth asserting explicitly rather than casting past the compiler,
  // in case that ordering assumption is ever broken by a refactor.
  throw new Error(
    "ORCHESTRATOR_SERVICE_TOKEN was not set by voice-runtime-simulator.ts's own top-of-file assignment.",
  );
}

export async function bootVoiceRuntimeSimulator(): Promise<VoiceRuntimeSimulator> {
  const aiProvider = new FakeAiProvider();
  const coreApiClient = new FakeCoreApiClient();
  const redisMock = new IoRedisMock() as unknown as RedisService;
  await redisMock.flushall();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(RedisService)
    .useValue(redisMock)
    .overrideProvider(AI_PROVIDER_ROUTER)
    .useValue(aiProvider as AiProviderPort)
    .overrideProvider(CORE_API_CLIENT)
    .useValue(coreApiClient)
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(new InMemoryIdempotencyStore())
    // Real pino with its pretty-print transport spawns a worker thread that
    // can't resolve inside Jest's module loader — unrelated to anything
    // this simulator is meant to verify, so it's swapped for the same
    // no-op StructuredLogger fake the unit specs already use, not a
    // simulator-only shortcut invented here.
    .overrideProvider(APP_LOGGER)
    .useValue(createNoopLogger())
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  // Mirrors main.ts's real bootstrap exactly — a simulator that skips the
  // global pipes/prefix would be testing a DIFFERENT contract than the one
  // a real Voice Runtime integrates against.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    aiProvider,
    coreApiClient,
    inject: app.inject.bind(app),
    serviceToken: SERVICE_TOKEN,
    async close() {
      await app.close();
    },
  };
}

/** Every route but the two `@Public()` health checks requires this — matches ServiceAuthGuard's real behavior, not a test-only shortcut. */
export function authHeader(serviceToken: string): { authorization: string } {
  return { authorization: `Bearer ${serviceToken}` };
}

/**
 * `POST /conversations/:id/turns` streams newline-delimited JSON (docs/28
 * §C.3) rather than a single JSON object — a real Voice Runtime reads the
 * response body incrementally and speaks each `{type:"chunk"}` line as it
 * arrives (see HttpOrchestratorClient), but a test that only cares about
 * the FINAL result (the overwhelming majority of this suite, unconcerned
 * with streaming itself) just needs that final `{type:"done", ...}` line
 * — this is the direct `res.json()` replacement for exactly that case.
 * Throws with the actual NDJSON body in the error message on anything
 * unexpected (no "done" line at all, or an `{type:"error"}` line instead)
 * rather than a bare "undefined" from a missing field, so a genuine
 * streaming regression fails loudly and specifically, not as an obscure
 * downstream assertion failure.
 */
export function parseTurnResult(res: { payload: string }): Record<string, unknown> {
  const lines = res.payload
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const done = lines.find((line) => line["type"] === "done");
  if (done) {
    return done;
  }
  const errorLine = lines.find((line) => line["type"] === "error");
  throw new Error(
    errorLine
      ? `Expected a "done" NDJSON line but got an "error" line instead: ${JSON.stringify(errorLine)}`
      : `Expected a "done" NDJSON line, found none. Raw body: ${res.payload}`,
  );
}

/** Every chunk's `text`, in the order they were streamed — for a test that specifically cares about the incremental streaming behavior itself, not just the final result. */
export function parseTurnChunks(res: { payload: string }): string[] {
  return res.payload
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => line["type"] === "chunk")
    .map((line) => line["text"] as string);
}
