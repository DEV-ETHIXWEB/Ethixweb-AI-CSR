import "./tracing";
import { startTracing, shutdownTracing } from "./tracing";
startTracing(process.env["OTEL_SERVICE_NAME"] ?? "voice-runtime");

import fastifyFormbody from "@fastify/formbody";
import fastifyWebsocket from "@fastify/websocket";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { MediaStreamGateway } from "./modules/telephony/interfaces/media-stream.gateway";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  const fastify = app.getHttpAdapter().getInstance();
  // Twilio's Voice webhook posts application/x-www-form-urlencoded, not
  // JSON — identical requirement to apps/core-api's own SMS webhook (see
  // that app's main.ts), registered directly on the underlying Fastify
  // instance since @nestjs/platform-fastify has no first-class "parse
  // this content-type" module wrapper.
  await fastify.register(fastifyFormbody);
  await fastify.register(fastifyWebsocket);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // The Media Stream WS route is registered on the raw Fastify instance,
  // not as a Nest controller route — see media-stream.gateway.ts's own
  // comment on why. Resolved from Nest's DI container so it can construct
  // a fresh CallSessionOrchestrator (and its full dependency graph) per
  // connection via ModuleRef.
  const gateway = app.get(MediaStreamGateway);
  gateway.register(fastify);

  app.enableShutdownHooks();

  const port = Number(process.env["PORT"] ?? 3200);
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
