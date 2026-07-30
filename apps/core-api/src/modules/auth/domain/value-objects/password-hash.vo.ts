import bcrypt from "bcryptjs";
import { ValidationDomainError } from "../../../../shared/domain/domain-error";

// NIST 800-63B favors length over composition rules (no forced
// mixed-case/digit/symbol requirements, which push users toward predictable
// patterns) — 12 characters minimum, no upper bound imposed here beyond
// bcrypt's own 72-byte input limit (enforced by the library itself).
const MIN_PASSWORD_LENGTH = 12;
const BCRYPT_COST_FACTOR = 12;

export class WeakPasswordError extends ValidationDomainError {
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    this.name = "WeakPasswordError";
  }
}

/**
 * Value object wrapping a bcrypt hash. The hashing library is a concrete,
 * stable algorithm choice bundled directly into this domain type rather
 * than abstracted behind a port/adapter — unlike CRM/LLM/voice vendors
 * (where swappability is the entire point of this platform, per docs/01
 * §1 rule 4 and docs/21), password hashing has no comparable
 * multi-provider requirement anywhere in the architecture docs, and
 * introducing a `PasswordHasher` port for a single, rarely-changed
 * algorithm would be exactly the premature abstraction this codebase's
 * own engineering principles reject. bcryptjs specifically (not the
 * native `bcrypt` package) because this environment has no C++ build
 * toolchain available (confirmed during dependency installation — see
 * docs/20-architecture-decision-records.md for the broader pattern of
 * flagging environment-driven choices explicitly).
 */
export class PasswordHash {
  // Precomputed once, at module load — a syntactically valid bcrypt hash
  // that never matches any real password. Used to give a nonexistent-user
  // login attempt a bcrypt comparison to run against, so the response-time
  // difference between "no such user" and "wrong password" doesn't leak
  // which one occurred (a real, standard timing-side-channel defense, not
  // theoretical — see LoginUseCase).
  private static readonly timingSafeDummyHash = bcrypt.hashSync(
    "timing-safety-dummy-password-never-matches-anything",
    BCRYPT_COST_FACTOR,
  );

  private constructor(private readonly hash: string) {}

  static timingSafeDummy(): PasswordHash {
    return new PasswordHash(PasswordHash.timingSafeDummyHash);
  }

  static async hash(plainPassword: string): Promise<PasswordHash> {
    if (plainPassword.length < MIN_PASSWORD_LENGTH) {
      throw new WeakPasswordError();
    }
    const hash = await bcrypt.hash(plainPassword, BCRYPT_COST_FACTOR);
    return new PasswordHash(hash);
  }

  /** Wraps an already-hashed value read back from storage — never re-hashes it. */
  static fromStoredHash(hash: string): PasswordHash {
    return new PasswordHash(hash);
  }

  async verify(plainPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, this.hash);
  }

  toStoredValue(): string {
    return this.hash;
  }
}
