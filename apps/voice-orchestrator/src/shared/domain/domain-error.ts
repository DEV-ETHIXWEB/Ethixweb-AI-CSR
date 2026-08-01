/** Identical to apps/core-api's shared/domain/domain-error.ts — see that file's own comment for the full rationale. Duplicated rather than imported: the two services share no runtime code, only the architectural convention. */
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
  abstract readonly retryAfterSeconds: number;
}
