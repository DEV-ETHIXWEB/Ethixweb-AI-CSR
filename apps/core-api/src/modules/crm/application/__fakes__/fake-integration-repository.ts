import { randomUUID } from "node:crypto";
import type { CrmCredential } from "../../domain/crm-credential";
import type { Integration } from "../../domain/integration.entity";
import type { CredentialEncryptor } from "../../domain/ports/credential-encryptor.port";
import type {
  CreateIntegrationInput,
  Db,
  IntegrationRepository,
} from "../../domain/ports/integration-repository.port";

/**
 * Mirrors PrismaIntegrationRepository's own shape (including depending on a
 * CredentialEncryptor to decrypt on read) rather than taking a shortcut of
 * storing plaintext credentials directly — so a test seeding a credential
 * through `seed()` and a real ConnectIntegrationUseCase call both produce
 * an integration whose credential can later be decrypted the same way.
 */
export class FakeIntegrationRepository implements IntegrationRepository {
  private readonly integrations = new Map<string, Integration>();
  private readonly encryptedCredentials = new Map<string, Buffer>();

  constructor(private readonly credentialEncryptor: CredentialEncryptor) {}

  async create(_db: Db, input: CreateIntegrationInput): Promise<Integration> {
    const now = new Date();
    const integration: Integration = {
      id: randomUUID(),
      tenantId: input.tenantId,
      businessId: input.businessId,
      crmType: input.crmType,
      authType: input.authType,
      config: input.config,
      status: "pending_verification",
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.integrations.set(integration.id, integration);
    this.encryptedCredentials.set(integration.id, input.encryptedCredentials);
    return integration;
  }

  async findById(_db: Db, tenantId: string, id: string): Promise<Integration | null> {
    const integration = this.integrations.get(id);
    return integration && integration.tenantId === tenantId ? integration : null;
  }

  async listByBusiness(_db: Db, tenantId: string, businessId: string): Promise<Integration[]> {
    return [...this.integrations.values()].filter(
      (integration) => integration.tenantId === tenantId && integration.businessId === businessId,
    );
  }

  async updateStatus(
    _db: Db,
    tenantId: string,
    id: string,
    status: string,
    lastVerifiedAt: Date | null,
  ): Promise<Integration> {
    const existing = this.integrations.get(id);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(
        `FakeIntegrationRepository: no integration ${id} found for tenant ${tenantId}`,
      );
    }
    const updated: Integration = { ...existing, status, lastVerifiedAt, updatedAt: new Date() };
    this.integrations.set(id, updated);
    return updated;
  }

  async getDecryptedCredential(_db: Db, tenantId: string, id: string): Promise<CrmCredential> {
    const integration = this.integrations.get(id);
    if (!integration || integration.tenantId !== tenantId) {
      throw new Error(
        `FakeIntegrationRepository: no integration ${id} found for tenant ${tenantId}`,
      );
    }
    const ciphertext = this.encryptedCredentials.get(id);
    if (!ciphertext) {
      throw new Error(`FakeIntegrationRepository: no credential stored for integration ${id}`);
    }
    return this.credentialEncryptor.decrypt(tenantId, ciphertext);
  }

  /** Test helper — seed an integration + its (fake-)encrypted credential directly, bypassing `create`. */
  async seed(integration: Integration, credential: CrmCredential): Promise<void> {
    this.integrations.set(integration.id, integration);
    this.encryptedCredentials.set(
      integration.id,
      await this.credentialEncryptor.encrypt(integration.tenantId, credential),
    );
  }
}
