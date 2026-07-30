/**
 * Base class every module's domain errors extend, so a single generic
 * exception filter (shared/http/domain-exception.filter.ts) can translate
 * ANY module's domain error to the right HTTP status without shared/ ever
 * importing a specific module's domain types — keeps the Hexagonal boundary
 * (docs/14-backend-stack-and-code-standards.md §2) intact: `shared` may only
 * depend on `shared`, and every `domain` layer may depend on `shared`.
 */
export abstract class DomainError extends Error {
  abstract readonly httpStatus: number;
}

export abstract class NotFoundDomainError extends DomainError {
  readonly httpStatus = 404;
}

export abstract class ConflictDomainError extends DomainError {
  readonly httpStatus = 409;
}

export abstract class ValidationDomainError extends DomainError {
  readonly httpStatus = 422;
}

export abstract class UnauthorizedDomainError extends DomainError {
  readonly httpStatus = 401;
}

export abstract class ForbiddenDomainError extends DomainError {
  readonly httpStatus = 403;
}

export abstract class TooManyRequestsDomainError extends DomainError {
  readonly httpStatus = 429;
  /** Seconds the client should wait before retrying — surfaced as a standard `Retry-After` response header (see DomainExceptionFilter), not just embedded in the human-readable message. */
  abstract readonly retryAfterSeconds: number;
}
