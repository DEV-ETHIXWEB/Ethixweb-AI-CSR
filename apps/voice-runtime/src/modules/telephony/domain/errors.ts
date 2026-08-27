import { BadRequestDomainError, ForbiddenDomainError } from "../../../shared/domain/domain-error";

export class InvalidTwilioSignatureError extends ForbiddenDomainError {
  constructor() {
    super("Invalid or missing X-Twilio-Signature");
    this.name = "InvalidTwilioSignatureError";
  }
}

export class UnroutableCallError extends BadRequestDomainError {
  constructor(public readonly toNumber: string) {
    super(`No tenant/business route configured for dialed number ${toNumber}`);
    this.name = "UnroutableCallError";
  }
}
