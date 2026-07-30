import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Opts a route OUT of the globally-applied AuthGuard (registered via
 * `APP_GUARD` in modules/auth/auth.module.ts) — fail-secure by default: a
 * new controller requires authentication unless it explicitly marks itself
 * public, rather than requiring every controller to remember to add a guard.
 * Lives in `shared/` (not inside the `auth` module itself) because every
 * module's controllers need this, including ones — like HealthController —
 * that have no other reason to depend on anything in `auth`.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
