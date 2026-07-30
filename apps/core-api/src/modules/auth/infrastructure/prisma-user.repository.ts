import { Injectable } from "@nestjs/common";
import { Prisma } from "@ethixweb/database";
import { EmailAlreadyRegisteredError } from "../domain/errors";
import type { User } from "../domain/user.entity";
import type { CreateUserInput, Db, UserRepository } from "../domain/ports/user-repository.port";

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

@Injectable()
export class PrismaUserRepository implements UserRepository {
  async create(db: Db, input: CreateUserInput): Promise<User> {
    try {
      return await db.user.create({
        data: {
          tenantId: input.tenantId,
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role,
        },
      });
    } catch (error) {
      // RegisterUserUseCase already checks findByEmail first, but that
      // check-then-insert has a real race: two concurrent registrations for
      // the same email can both pass it before either row exists. The
      // `@@unique([tenantId, email])` constraint is the actual backstop —
      // without translating its violation here, the second request would
      // surface as an unhandled 500 instead of the same clean
      // EmailAlreadyRegisteredError the non-racing path already returns.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new EmailAlreadyRegisteredError(input.email);
      }
      throw error;
    }
  }

  async findById(db: Db, tenantId: string, id: string): Promise<User | null> {
    return db.user.findFirst({ where: { id, tenantId } });
  }

  async findByEmail(db: Db, tenantId: string, email: string): Promise<User | null> {
    // Explicit tenantId filter AND RLS-scoped transaction — defense in
    // depth (see this method's port-level comment), not redundancy.
    return db.user.findFirst({ where: { tenantId, email } });
  }

  async updateLastLoginAt(db: Db, id: string, at: Date): Promise<void> {
    await db.user.update({ where: { id }, data: { lastLoginAt: at } });
  }
}
