import {
  ConflictDomainError,
  ForbiddenDomainError,
  NotFoundDomainError,
  ValidationDomainError,
} from "../../../shared/domain/domain-error";

export class ToolNotFoundError extends NotFoundDomainError {
  constructor(public readonly toolName: string) {
    super(
      `Unknown tool: "${toolName}" — not in the registry (docs/04 §1: "the tool broker's registry doesn't contain it").`,
    );
    this.name = "ToolNotFoundError";
  }
}

export class ToolInputValidationError extends ValidationDomainError {
  constructor(
    public readonly toolName: string,
    public readonly issues: string,
  ) {
    super(`Invalid arguments for tool "${toolName}": ${issues}`);
    this.name = "ToolInputValidationError";
  }
}

export class ToolNotAuthorizedError extends ForbiddenDomainError {
  constructor(public readonly toolName: string) {
    super(`Tool "${toolName}" is not in this agent config's allowlist.`);
    this.name = "ToolNotAuthorizedError";
  }
}

/** docs/04 §2 stage 3: "seen before, still pending → Return cached in-flight result (dedup concurrent duplicate calls)." Mirrors CrmSyncInProgressError's exact role in apps/core-api's crm module. */
export class ToolCallInFlightError extends ConflictDomainError {
  constructor(public readonly idempotencyKey: string) {
    super(`An identical tool call is already in flight: ${idempotencyKey}`);
    this.name = "ToolCallInFlightError";
  }
}
