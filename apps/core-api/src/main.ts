import "./tracing";
import { startTracing, shutdownTracing } from "./tracing";
startTracing(process.env["OTEL_SERVICE_NAME"] ?? "core-api");

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
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

  // Twilio's inbound SMS webhook (modules/notifications/interfaces/sms-webhooks.controller.ts)
  // POSTs `application/x-www-form-urlencoded`. Nest's FastifyAdapter
  // already registers a urlencoded content-type parser itself
  // (registerUrlencodedContentParser, querystring.parse-based) during
  // app.init()/app.listen() — sufficient for Twilio's flat key-value form
  // bodies (no nested/array fields). A manual `@fastify/formbody`
  // registration was tried here previously but crashes bootstrap with
  // FST_ERR_CTP_ALREADY_PRESENT: it registers the same content type
  // directly on the raw Fastify instance without going through Nest's
  // `useBodyParser` (which sets the `_isParserRegistered` guard), so
  // Nest's own registration collides with it moments later. Do not
  // re-add a manual `@fastify/formbody` registration without also
  // routing it through `app.useBodyParser(...)`.

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
