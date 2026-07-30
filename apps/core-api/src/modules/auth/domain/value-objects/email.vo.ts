import { ValidationDomainError } from "../../../../shared/domain/domain-error";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvalidEmailError extends ValidationDomainError {
  constructor(public readonly rawValue: string) {
    super(`Invalid email address: "${rawValue}"`);
    this.name = "InvalidEmailError";
  }
}

/**
 * Value object, not a plain string field: normalizes case/whitespace once,
 * at construction, so every downstream comparison (login lookup, uniqueness
 * check) is comparing the same canonical form without repeating
 * `.trim().toLowerCase()` at every call site.
 */
export class Email {
  private constructor(public readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      throw new InvalidEmailError(raw);
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
