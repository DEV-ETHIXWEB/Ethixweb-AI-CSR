/** docs/06-database-schema.md INTEGRATIONS, docs/05-crm-integration.md. */
export interface Integration {
  id: string;
  tenantId: string;
  businessId: string;
  crmType: string;
  authType: string;
  /** Never decrypted here — only PrismaIntegrationRepository + CredentialEncryptor ever touch the raw bytes. */
  config: Record<string, unknown>;
  status: string;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const INTEGRATION_STATUS = {
  PENDING_VERIFICATION: "pending_verification",
  ACTIVE: "active",
  INVALID_CREDENTIALS: "invalid_credentials",
  DISCONNECTED: "disconnected",
} as const;
