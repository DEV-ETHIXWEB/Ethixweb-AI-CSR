import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@ethixweb/database";
import type { Integration } from "../domain/integration.entity";
import type { CrmCredential } from "../domain/crm-credential";
import {
  CREDENTIAL_ENCRYPTOR,
  type CredentialEncryptor,
} from "../domain/ports/credential-encryptor.port";
import type {
  CreateIntegrationInput,
  Db,
  IntegrationRepository,
} from "../domain/ports/integration-repository.port";

type IntegrationRow = {
  id: string;
  tenantId: string;
  businessId: string;
  crmType: string;
  authType: string;
  config: unknown;
  status: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toEntity(row: IntegrationRow): Integration {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    crmType: row.crmType,
    authType: row.authType,
    config: (row.config ?? {}) as Record<string, unknown>,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PrismaIntegrationRepository implements IntegrationRepository {
  constructor(
    @Inject(CREDENTIAL_ENCRYPTOR) private readonly credentialEncryptor: CredentialEncryptor,
  ) {}

  async create(db: Db, input: CreateIntegrationInput): Promise<Integration> {
    const row = await db.integration.create({
      data: {
        tenantId: input.tenantId,
        businessId: input.businessId,
        crmType: input.crmType,
        authType: input.authType,
        // `new Uint8Array(...)` rather than the Buffer directly: Buffer's
        // type extends Uint8Array<ArrayBufferLike> (which could in theory
        // be a SharedArrayBuffer), while Prisma's Bytes field expects
        // Uint8Array<ArrayBuffer> specifically — a TS structural-typing
        // strictness mismatch, not a real runtime concern (Buffer's backing
        // store is always a real ArrayBuffer here).
        encryptedCredentials: new Uint8Array(input.encryptedCredentials),
        config: input.config as Prisma.InputJsonValue,
      },
    });
    return toEntity(row);
  }

  async findById(db: Db, tenantId: string, id: string): Promise<Integration | null> {
    const row = await db.integration.findFirst({ where: { id, tenantId } });
    return row ? toEntity(row) : null;
  }

  async listByBusiness(db: Db, tenantId: string, businessId: string): Promise<Integration[]> {
    const rows = await db.integration.findMany({
      where: { tenantId, businessId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toEntity);
  }

  async updateStatus(
    db: Db,
    tenantId: string,
    id: string,
    status: string,
    lastVerifiedAt: Date | null,
  ): Promise<Integration> {
    // `update()` requires a unique-field WHERE (id alone) — updateMany + a
    // re-fetch keeps the explicit tenantId check, the same pattern used
    // throughout this codebase (auth module's api-key revoke, tenants
    // module's business rename) for a table with no compound unique
    // constraint to lean on instead.
    const { count } = await db.integration.updateMany({
      where: { id, tenantId },
      data: { status, lastVerifiedAt },
    });
    if (count === 0) {
      throw new Error(
        `PrismaIntegrationRepository.updateStatus: no integration ${id} found for tenant ${tenantId}`,
      );
    }
    const updated = await db.integration.findFirst({ where: { id, tenantId } });
    if (!updated) {
      throw new Error(
        `PrismaIntegrationRepository.updateStatus: integration ${id} vanished after update`,
      );
    }
    return toEntity(updated);
  }

  async getDecryptedCredential(db: Db, tenantId: string, id: string): Promise<CrmCredential> {
    const row = await db.integration.findFirst({ where: { id, tenantId } });
    if (!row) {
      throw new Error(
        `PrismaIntegrationRepository.getDecryptedCredential: no integration ${id} found for tenant ${tenantId}`,
      );
    }
    return this.credentialEncryptor.decrypt(tenantId, Buffer.from(row.encryptedCredentials));
  }
}
