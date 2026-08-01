import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Identical rationale to apps/core-api's own Public decorator — opts a route out of the globally-applied ServiceAuthGuard (health checks). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
