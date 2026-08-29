/** Identical to apps/voice-orchestrator's shared/domain/domain-error.ts — see that file's own comment for the full rationale. Duplicated rather than imported: services share no runtime code, only the architectural convention. */
export abstract class DomainError extends Error {
  abstract readonly httpStatus: number;
}

export abstract class ForbiddenDomainError extends DomainError {
  readonly httpStatus = 403;
}

export abstract class BadRequestDomainError extends DomainError {
  readonly httpStatus = 400;
}
