import type { Prisma, PrismaClient } from "@ethixweb/database";
import type { Integration } from "../integration.entity";
import type { CrmCredential } from "../crm-credential";

/** `integrations` IS RLS-scoped — every method takes the tenant-scoped transaction client (docs/20 ADR-014). */
export type Db = PrismaClient | Prisma.TransactionClient;

export interface CreateIntegrationInput {
  tenantId: string;
  businessId: string;
  crmType: string;
  authType: string;
  /** Already-encrypted bytes — the repository never sees plaintext credentials, only CredentialEncryptor's output. */
  encryptedCredentials: Buffer;
  config: Record<string, unknown>;
}

export interface IntegrationRepository {
  create(db: Db, input: CreateIntegrationInput): Promise<Integration>;
  /** Tenant-scoped defense in depth, same reasoning as every other tenant-scoped `findById` in this codebase (auth module, tenants module). */
  findById(db: Db, tenantId: string, id: string): Promise<Integration | null>;
  listByBusiness(db: Db, tenantId: string, businessId: string): Promise<Integration[]>;
  updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    status: string,
    lastVerifiedAt: Date | null,
  ): Promise<Integration>;
  /** Decrypts and returns the credential for one integration — the only read path that ever sees plaintext. */
  getDecryptedCredential(db: Db, tenantId: string, id: string): Promise<CrmCredential>;
}

export const INTEGRATION_REPOSITORY = Symbol("INTEGRATION_REPOSITORY");
