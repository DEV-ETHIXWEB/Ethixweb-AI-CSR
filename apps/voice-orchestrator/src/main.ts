import "./tracing";
import { startTracing, shutdownTracing } from "./tracing";
startTracing(process.env["OTEL_SERVICE_NAME"] ?? "voice-orchestrator");

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

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
    .setTitle("Ethixweb AI CSR Platform — Voice AI Orchestrator")
    .setDescription(
      "Conversation orchestration, tool broker, AI provider abstraction, prompt management. " +
        "Owns everything AFTER audio has been converted into structured events by the Voice " +
        "Runtime (telephony/STT/TTS transport) — a separate service and an external client of " +
        "this API, not something this service implements. Every route requires a service " +
        "bearer token unless explicitly marked otherwise.",
    )
    .setVersion("1.0")
    .addBearerAuth({ type: "http", scheme: "bearer" }, "service-token")
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("docs/api", app, document);

  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? 3100);
  await app.listen(port, "0.0.0.0");

  const shutdown = async (): Promise<void> => {
    await app.close();
    await shutdownTracing();
    process.exit(0);
  };
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
