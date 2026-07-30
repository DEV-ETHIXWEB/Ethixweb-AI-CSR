/**
 * Discriminated union, not a single shape — Housecall Pro's confirmed model
 * is a single long-lived admin-issued bearer API key (docs/05-crm-integration.md
 * §2.1: "the adapter's credential layer holds one long-lived bearer key...
 * kept swappable behind the CRMAdapter interface"), while ServiceTitan's
 * documented model is OAuth2 client-credentials (docs/05 §5) — a future real
 * ServiceTitan adapter needs a token pair + expiry, not a bare string. Kept
 * generic here so the credential SHAPE is a per-CRM adapter decision, not a
 * schema constraint every future adapter has to bend to fit.
 */
export type CrmCredential =
  | {
      type: "api_key";
      apiKey: string;
      baseUrl?: string | undefined;
      webhookSigningSecret?: string | undefined;
    }
  | {
      type: "oauth";
      accessToken: string;
      refreshToken?: string | undefined;
      expiresAt?: string | undefined;
      baseUrl?: string | undefined;
      webhookSigningSecret?: string | undefined;
    };
