import { UnauthorizedDomainError } from "../domain/domain-error";

export class InvalidServiceTokenError extends UnauthorizedDomainError {
  constructor() {
    super("Missing or invalid service bearer token.");
    this.name = "InvalidServiceTokenError";
  }
}
