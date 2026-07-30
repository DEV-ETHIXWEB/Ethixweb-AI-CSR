import type { Prisma, PrismaClient, UserRole } from "@ethixweb/database";
import type { User } from "../user.entity";

/** `users` is RLS-scoped (docs/20 ADR-013/ADR-014) — every method takes the tenant-scoped transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateUserInput {
  tenantId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export interface UserRepository {
  /**
   * Throws `EmailAlreadyRegisteredError` (../errors.ts) on a `(tenantId,
   * email)` unique-constraint violation — the backstop for a registration
   * race the application-layer pre-check in RegisterUserUseCase can't
   * close on its own: two concurrent registrations for the same email can
   * both pass that check before either inserts, so the database's own
   * `@@unique([tenantId, email])` constraint (packages/database/prisma/schema.prisma)
   * is the actual source of truth, not just a redundant guard.
   */
  create(db: Db, input: CreateUserInput): Promise<User>;
  /**
   * `tenantId` passed explicitly AND the query runs inside an
   * already-tenant-scoped RLS transaction — the same defense-in-depth
   * reasoning as `findByEmail` below and `ApiKeyRepository.findById`.
   * Callers (GetCurrentUserUseCase for `/auth/me`, RefreshTokenUseCase
   * re-fetching the token's owner) both already know the tenant from an
   * already-verified JWT, so there's no reason to fall back to a bare
   * global-primary-key lookup with no application-layer tenant check at all.
   */
  findById(db: Db, tenantId: string, id: string): Promise<User | null>;
  /**
   * Login lookup — `tenantId` is passed explicitly AND the query runs
   * inside an already tenant-scoped RLS transaction: deliberate defense in
   * depth, not redundancy. Relying solely on RLS for a credential lookup
   * (no application-layer filter at all) would be weaker than every other
   * tenant-scoped defense in this codebase, which consistently pairs RLS
   * with an explicit check (e.g. TenantsController.assertOwnTenant).
   */
  findByEmail(db: Db, tenantId: string, email: string): Promise<User | null>;
  updateLastLoginAt(db: Db, id: string, at: Date): Promise<void>;
}

export const USER_REPOSITORY = Symbol("USER_REPOSITORY");
