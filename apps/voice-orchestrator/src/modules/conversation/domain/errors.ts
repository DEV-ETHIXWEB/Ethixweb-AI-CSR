import { ConflictDomainError, NotFoundDomainError } from "../../../shared/domain/domain-error";

export class ConversationNotFoundError extends NotFoundDomainError {
  constructor(public readonly conversationId: string) {
    super(`Conversation not found: ${conversationId}`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationAlreadyEndedError extends ConflictDomainError {
  constructor(public readonly conversationId: string) {
    super(`Conversation ${conversationId} has already ended — no further turns accepted.`);
    this.name = "ConversationAlreadyEndedError";
  }
}

export class ConversationAlreadyExistsError extends ConflictDomainError {
  constructor(public readonly callId: string) {
    super(`A conversation already exists for call ${callId}.`);
    this.name = "ConversationAlreadyExistsError";
  }
}
