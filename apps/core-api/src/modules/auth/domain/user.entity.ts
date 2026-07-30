import type { UserRole } from "@ethixweb/database";

export type { UserRole };

/** docs/06-database-schema.md USERS, docs/08-security-observability-reliability.md §1.1 RBAC roles. */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  /** The bcrypt hash string — see domain/value-objects/password-hash.vo.ts for hash/verify behavior. Never the plaintext password. */
  passwordHash: string;
  role: UserRole;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The subset of `User` ever safe to return from an API response or log line — never includes `passwordHash`. */
export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}
