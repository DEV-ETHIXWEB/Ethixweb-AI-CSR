import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
  TooManyRequestsDomainError,
  UnauthorizedDomainError,
} from "../../../shared/domain/domain-error";

/**
 * Deliberately generic — never "user not found" vs. "wrong password" as
 * distinct errors at this boundary. Distinguishing them in the response
 * lets an attacker enumerate valid emails; the login use-case maps both
 * failure modes to this single error before it ever reaches the HTTP layer.
 */
export class InvalidCredentialsError extends UnauthorizedDomainError {
  constructor() {
    super("Invalid email or password.");
    this.name = "InvalidCredentialsError";
  }
}

export class InvalidRefreshTokenError extends UnauthorizedDomainError {
  constructor() {
    super("Refresh token is invalid, expired, or has been revoked.");
    this.name = "InvalidRefreshTokenError";
  }
}

export class InvalidAccessTokenError extends UnauthorizedDomainError {
  constructor() {
    super("Access token is invalid or expired.");
    this.name = "InvalidAccessTokenError";
  }
}

export class InvalidApiKeyError extends UnauthorizedDomainError {
  constructor() {
    super("API key is invalid, expired, or has been revoked.");
    this.name = "InvalidApiKeyError";
  }
}

export class InsufficientRoleError extends ForbiddenDomainError {
  constructor(
    public readonly requiredRoles: readonly string[],
    public readonly actualRole: string,
  ) {
    super(`Requires one of roles [${requiredRoles.join(", ")}], caller has "${actualRole}".`);
    this.name = "InsufficientRoleError";
  }
}

export class UserNotFoundError extends NotFoundDomainError {
  constructor(public readonly userId: string) {
    super(`User not found: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

export class ApiKeyNotFoundError extends NotFoundDomainError {
  constructor(public readonly apiKeyId: string) {
    super(`API key not found: ${apiKeyId}`);
    this.name = "ApiKeyNotFoundError";
  }
}

export class EmailAlreadyRegisteredError extends ConflictDomainError {
  constructor(public readonly email: string) {
    super(`A user with email "${email}" already exists for this tenant.`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class UnsupportedCredentialTypeError extends ForbiddenDomainError {
  constructor(
    public readonly requiredAuthType: "jwt" | "api_key",
    public readonly actualAuthType: "jwt" | "api_key",
  ) {
    super(
      `This operation requires a "${requiredAuthType}"-authenticated caller, not "${actualAuthType}".`,
    );
    this.name = "UnsupportedCredentialTypeError";
  }
}

export class RateLimitExceededError extends TooManyRequestsDomainError {
  constructor(public readonly retryAfterSeconds: number) {
    super(`Too many attempts — retry after ${retryAfterSeconds} second(s).`);
    this.name = "RateLimitExceededError";
  }
}
