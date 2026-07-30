import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { LoginUseCase } from "../application/commands/login.use-case";
import { LogoutUseCase } from "../application/commands/logout.use-case";
import { RefreshTokenUseCase } from "../application/commands/refresh-token.use-case";
import { RegisterUserUseCase } from "../application/commands/register-user.use-case";
import { GetCurrentUserUseCase } from "../application/queries/get-current-user.use-case";
import { UnsupportedCredentialTypeError } from "../domain/errors";
import { CurrentPrincipal } from "../../../shared/auth/current-principal.decorator";
import { Public } from "../../../shared/auth/public.decorator";
import { Roles } from "../../../shared/auth/roles.decorator";
import type { AuthPrincipal } from "../../../shared/auth/request-principal";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { RefreshedTokenResponseDto, TokenResponseDto } from "./dto/token-response.dto";
import { RegisterUserDto } from "./dto/register-user.dto";
import { UserResponseDto } from "./dto/user-response.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly registerUserUseCase: RegisterUserUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
  ) {}

  @Public()
  @Post("login")
  @ApiOperation({ summary: "Exchange email/password for an access + refresh token pair" })
  @ApiResponse({ status: 200, description: "Login succeeded", type: TokenResponseDto })
  @ApiResponse({
    status: 401,
    description:
      "Invalid email or password (generic — never distinguishes the two, see InvalidCredentialsError)",
  })
  @ApiResponse({
    status: 429,
    description: "Too many attempts for this (tenant, email) — see RateLimitExceededError",
  })
  async login(@Body() dto: LoginDto): Promise<TokenResponseDto> {
    const result = await this.loginUseCase.execute(dto);
    return TokenResponseDto.fromDomain(result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post("refresh")
  @ApiOperation({ summary: "Rotate a refresh token for a new access + refresh token pair" })
  @ApiResponse({ status: 200, description: "Rotation succeeded", type: RefreshedTokenResponseDto })
  @ApiResponse({
    status: 401,
    description:
      "Refresh token is invalid, expired, revoked, or already used (rotation makes reuse detectable)",
  })
  async refresh(@Body() dto: RefreshTokenDto): Promise<RefreshedTokenResponseDto> {
    const result = await this.refreshTokenUseCase.execute(dto.refreshToken);
    return new RefreshedTokenResponseDto(result.accessToken, result.refreshToken);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post("logout")
  @ApiOperation({
    summary: "Revoke a refresh token — idempotent, never errors on an already-invalid token",
  })
  @ApiResponse({ status: 204, description: "Always succeeds, even for an already-invalid token" })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logoutUseCase.execute(dto.refreshToken);
  }

  @ApiBearerAuth("bearer")
  @Get("me")
  @ApiOperation({
    summary: "The authenticated user's own profile — JWT-authenticated callers only",
  })
  @ApiResponse({ status: 200, description: "The caller's own profile", type: UserResponseDto })
  @ApiResponse({
    status: 403,
    description: "Caller authenticated via API key, which has no self-profile",
  })
  async me(@CurrentPrincipal() principal: AuthPrincipal): Promise<UserResponseDto> {
    if (principal.authType !== "jwt") {
      // A raw `Error` here would bypass DomainExceptionFilter entirely and
      // surface as an unhandled 500 — found during a security review pass.
      // An API-key-authenticated caller has no "self" user profile to
      // return; this is a genuinely different case from "not found," hence
      // not reusing UserNotFoundError here.
      throw new UnsupportedCredentialTypeError("jwt", principal.authType);
    }
    // Re-fetched from the database on every call, not decoded straight off
    // the JWT payload — the token's claims are a snapshot from whenever it
    // was issued (up to 15 minutes stale) and deliberately don't carry
    // `email` at all, so this is the only correct source for "my profile
    // right now."
    const user = await this.getCurrentUserUseCase.execute(principal.tenantId, principal.userId);
    return UserResponseDto.fromDomain(user);
  }

  @ApiBearerAuth("bearer")
  @Roles("owner", "admin")
  @Post("users")
  @ApiOperation({
    summary: "Invite a teammate into the caller's own tenant — owner/admin only",
    description:
      "Bootstrapping a brand-new tenant's very first user is deliberately NOT exposed here (there is no " +
      "existing owner/admin to authorize it yet) — see docs/13-implementation-backlog.md's seed-script task; " +
      "Phase 1 onboarding is manual/ops-driven per docs/15-tenant-lifecycle-billing-and-analytics.md §1. " +
      'An `admin` caller may not set `role: "owner"` on the new user — see role-assignment-policy.ts.',
  })
  @ApiResponse({ status: 201, description: "User created", type: UserResponseDto })
  @ApiResponse({
    status: 403,
    description:
      "Caller's role cannot grant the requested role (e.g. admin granting owner), or caller lacks owner/admin entirely",
  })
  @ApiResponse({ status: 409, description: "Email already registered in this tenant" })
  async registerTeammate(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body() dto: RegisterUserDto,
  ): Promise<UserResponseDto> {
    // RolesGuard already guarantees principal.authType === "jwt" here (an
    // API-key principal never has a role, so it can never satisfy @Roles()).
    const jwtPrincipal = principal as Extract<AuthPrincipal, { authType: "jwt" }>;
    const user = await this.registerUserUseCase.execute({
      tenantId: jwtPrincipal.tenantId,
      actingUserRole: jwtPrincipal.role,
      ...dto,
    });
    return UserResponseDto.fromDomain(user);
  }
}
