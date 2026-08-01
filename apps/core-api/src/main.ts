import "./tracing";
import { startTracing, shutdownTracing } from "./tracing";
startTracing(process.env["OTEL_SERVICE_NAME"] ?? "core-api");

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import formbody from "@fastify/formbody";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    // `rawBody: true` makes the exact, unparsed request body bytes
    // available as `request.rawBody` alongside normal JSON parsing — CRM
    // webhook signature verification (modules/crm/interfaces/crm-webhooks.controller.ts)
    // MUST verify over the raw bytes, never a re-serialized JSON object
    // (see shared/webhooks/hmac-signature.util.ts's own comment on why).
    { rawBody: true },
  );

  // Registered directly on the underlying Fastify instance (Nest's
  // FastifyAdapter has no first-class `.register()` wrapper for plugins
  // that isn't just a passthrough to this) — Twilio's inbound SMS webhook
  // (modules/notifications/interfaces/sms-webhooks.controller.ts) POSTs
  // `application/x-www-form-urlencoded`, which Fastify doesn't parse by
  // default (only `application/json` is built in). Without this, that
  // route's `@Body()` would be empty/undefined for every real Twilio
  // request. `@fastify/formbody` ships as a transitive dependency of
  // `@nestjs/platform-fastify` already but is declared directly in this
  // app's package.json rather than relied on as a phantom dependency.
  await app.getHttpAdapter().getInstance().register(formbody);

  // Fails closed: unknown properties are stripped, not silently accepted,
  // and validation failures reject the request rather than proceeding with
  // partially-valid input — see docs/04-ai-tool-architecture.md §2 for the
  // same "validate before anything executes" discipline applied to tools.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });

  const openApiConfig = new DocumentBuilder()
    .setTitle("Ethixweb AI CSR Platform — Core API")
    .setDescription(
      "Tenant/business/config CRUD, tool broker, and lead-inbox API. " +
        "See docs/14-backend-stack-and-code-standards.md §8 for the versioning policy this API follows. " +
        "Every route requires authentication (JWT Bearer token or X-Api-Key header) unless explicitly " +
        "marked otherwise — see modules/auth/interfaces/guards/auth.guard.ts.",
    )
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
    .addApiKey({ type: "apiKey", name: "X-Api-Key", in: "header" }, "api-key")
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("docs/api", app, document);

  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen(port, "0.0.0.0");

  const shutdown = async (): Promise<void> => {
    await app.close();
    await shutdownTracing();
    process.exit(0);
  };
  // `process.on` listeners must be void-returning — wrapped rather than
  // passed directly so a rejection during shutdown is caught and surfaced,
  // instead of becoming an unhandled promise rejection during process exit.
  const handleShutdownSignal = (): void => {
    shutdown().catch((error: unknown) => {
      // eslint-disable-next-line no-console -- no Nest/DI logger survives past app.close()
      console.error("Error during graceful shutdown", error);
      process.exit(1);
    });
  };
  process.on("SIGTERM", handleShutdownSignal);
  process.on("SIGINT", handleShutdownSignal);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal error during bootstrap", error);
  process.exit(1);
});
