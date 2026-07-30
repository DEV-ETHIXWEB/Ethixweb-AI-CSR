import type { CrmCredential } from "../../domain/crm-credential";
import type { CredentialEncryptor } from "../../domain/ports/credential-encryptor.port";

/** Deterministic, non-cryptographic fake — application-layer tests exercise orchestration, not AES-GCM internals (those are covered separately in aes-gcm-credential-encryptor.spec.ts). */
export class FakeCredentialEncryptor implements CredentialEncryptor {
  async encrypt(_tenantId: string, credential: CrmCredential): Promise<Buffer> {
    return Buffer.from(JSON.stringify(credential), "utf8");
  }

  async decrypt(_tenantId: string, ciphertext: Buffer): Promise<CrmCredential> {
    return JSON.parse(ciphertext.toString("utf8")) as CrmCredential;
  }
}
