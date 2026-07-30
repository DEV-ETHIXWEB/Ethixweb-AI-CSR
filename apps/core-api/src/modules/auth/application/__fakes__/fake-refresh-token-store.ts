import type { RefreshTokenStore } from "../../domain/ports/refresh-token-store.port";

export class FakeRefreshTokenStore implements RefreshTokenStore {
  private readonly validTokens = new Set<string>();

  private key(userId: string, jti: string): string {
    return `${userId}:${jti}`;
  }

  async store(userId: string, jti: string, _ttlSeconds: number): Promise<void> {
    this.validTokens.add(this.key(userId, jti));
  }

  async isValid(userId: string, jti: string): Promise<boolean> {
    return this.validTokens.has(this.key(userId, jti));
  }

  // Synchronous body (no internal `await`) so this is genuinely atomic with
  // respect to other in-flight calls, the same guarantee the real
  // Lua-script-backed Redis implementation provides — see the port's own
  // comment on why rotation requires this over separate isValid()+revoke().
  async consume(userId: string, jti: string): Promise<boolean> {
    const key = this.key(userId, jti);
    if (!this.validTokens.has(key)) {
      return false;
    }
    this.validTokens.delete(key);
    return true;
  }

  async revoke(userId: string, jti: string): Promise<void> {
    this.validTokens.delete(this.key(userId, jti));
  }

  async revokeAll(userId: string): Promise<void> {
    for (const key of this.validTokens) {
      if (key.startsWith(`${userId}:`)) {
        this.validTokens.delete(key);
      }
    }
  }
}
