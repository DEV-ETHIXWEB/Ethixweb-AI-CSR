import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { CreateApiKeyUseCase } from "./application/commands/create-api-key.use-case";
import { LoginUseCase } from "./application/commands/login.use-case";
import { LogoutUseCase } from "./application/commands/logout.use-case";
import { RefreshTokenUseCase } from "./application/commands/refresh-token.use-case";
import { RegisterUserUseCase } from "./application/commands/register-user.use-case";
import { RevokeApiKeyUseCase } from "./application/commands/revoke-api-key.use-case";
import { AuthenticateApiKeyUseCase } from "./application/queries/authenticate-api-key.use-case";
import { GetCurrentUserUseCase } from "./application/queries/get-current-user.use-case";
import { ListApiKeysUseCase } from "./application/queries/list-api-keys.use-case";
import { API_KEY_REPOSITORY } from "./domain/ports/api-key-repository.port";
import { RATE_LIMITER } from "./domain/ports/rate-limiter.port";
import { REFRESH_TOKEN_STORE } from "./domain/ports/refresh-token-store.port";
import { TOKEN_SERVICE } from "./domain/ports/token-service.port";
import { USER_REPOSITORY } from "./domain/ports/user-repository.port";
import { JwtTokenService } from "./infrastructure/jwt-token.service";
import { PrismaApiKeyRepository } from "./infrastructure/prisma-api-key.repository";
import { PrismaUserRepository } from "./infrastructure/prisma-user.repository";
import { RedisRateLimiter } from "./infrastructure/redis-rate-limiter";
import { RedisRefreshTokenStore } from "./infrastructure/redis-refresh-token.store";
import { ApiKeysController } from "./interfaces/api-keys.controller";
import { AuthController } from "./interfaces/auth.controller";
import { AuthGuard } from "./interfaces/guards/auth.guard";
import { RolesGuard } from "./interfaces/guards/roles.guard";

@Module({
  // JwtModule registered with no default secret/options — JwtTokenService
  // passes an explicit `secret`/`expiresIn` per call for both access and
  // refresh tokens (see that file's own comment on why two secrets, not one
  // shared JwtModule-level config).
  imports: [JwtModule.register({})],
  controllers: [AuthController, ApiKeysController],
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: API_KEY_REPOSITORY, useClass: PrismaApiKeyRepository },
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    { provide: REFRESH_TOKEN_STORE, useClass: RedisRefreshTokenStore },
    { provide: RATE_LIMITER, useClass: RedisRateLimiter },
    RegisterUserUseCase,
    LoginUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    GetCurrentUserUseCase,
    CreateApiKeyUseCase,
    RevokeApiKeyUseCase,
    ListApiKeysUseCase,
    AuthenticateApiKeyUseCase,
    // Registered as APP_GUARD here (not in app.module.ts) because this is
    // where all of AuthGuard's own dependencies (TOKEN_SERVICE,
    // AuthenticateApiKeyUseCase) are already provided — NestJS's APP_GUARD
    // token is collected globally regardless of which module registers it,
    // so this still applies to every route in the application, including
    // the tenants/businesses controllers in a different module. Order
    // matters: AuthGuard establishes `request.principal` before RolesGuard
    // reads it.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
