import { randomUUID } from "node:crypto";
import { EmailAlreadyRegisteredError } from "../../domain/errors";
import type { CreateUserInput, Db, UserRepository } from "../../domain/ports/user-repository.port";
import type { User } from "../../domain/user.entity";

export class FakeUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();

  // Synchronous body (no internal `await`) so this check-then-insert is
  // genuinely atomic with respect to other in-flight calls — the same
  // `(tenantId, email)` uniqueness the real `@@unique` constraint enforces
  // in Postgres, and the same reasoning PrismaUserRepository.create()'s own
  // comment gives for why RegisterUserUseCase's pre-check alone isn't
  // enough under real concurrency.
  async create(_db: Db, input: CreateUserInput): Promise<User> {
    for (const existing of this.users.values()) {
      if (existing.tenantId === input.tenantId && existing.email === input.email) {
        throw new EmailAlreadyRegisteredError(input.email);
      }
    }
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      tenantId: input.tenantId,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user && user.tenantId === tenantId ? user : null;
  }

  async findByEmail(_db: Db, tenantId: string, email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.tenantId === tenantId && user.email === email) {
        return user;
      }
    }
    return null;
  }

  async updateLastLoginAt(_db: Db, id: string, at: Date): Promise<void> {
    const existing = this.users.get(id);
    if (existing) {
      this.users.set(id, { ...existing, lastLoginAt: at });
    }
  }

  /** Test helper — seed a user directly, bypassing `create`. */
  seed(user: User): void {
    this.users.set(user.id, user);
  }
}
