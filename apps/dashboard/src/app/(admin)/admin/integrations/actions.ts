"use server";

import { revalidatePath } from "next/cache";
import { coreApiFetch } from "@/lib/core-api-client";
import type { Integration } from "@/lib/integrations-types";

export interface ActionState {
  ok: boolean;
  error: string | null;
}

const INITIAL: ActionState = { ok: false, error: null };

/**
 * The submitted API key/access token is a Server Action argument — it
 * travels browser -> this app's server (over the same-origin form POST
 * React wires up for "use server" actions) -> core-api, and is never
 * written to any log here (no console.* call touches `formData` or the
 * parsed credential in this file). core-api encrypts it at rest
 * (AesGcmCredentialEncryptor, confirmed in an earlier phase's audit) —
 * this action does not weaken or bypass that, it only forwards the
 * already-validated shape core-api's own ConnectIntegrationDto expects.
 */
export async function connectIntegration(
  businessId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const crmType = String(formData.get("crmType") ?? "");
  const credentialType = String(formData.get("credentialType") ?? "api_key");
  const apiKey = String(formData.get("apiKey") ?? "");
  const baseUrl = String(formData.get("baseUrl") ?? "");

  try {
    await coreApiFetch<Integration>("/integrations", {
      method: "POST",
      body: {
        businessId,
        crmType,
        credential: {
          type: credentialType,
          ...(credentialType === "api_key" ? { apiKey } : { accessToken: apiKey }),
          ...(baseUrl ? { baseUrl } : {}),
        },
      },
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Connection failed." };
  }
  revalidatePath("/admin/integrations");
  return { ...INITIAL, ok: true };
}

export async function verifyIntegration(id: string): Promise<Integration> {
  const result = await coreApiFetch<Integration>(`/integrations/${id}/verify`, { method: "POST" });
  revalidatePath("/admin/integrations");
  return result;
}

export async function disconnectIntegration(id: string): Promise<void> {
  await coreApiFetch(`/integrations/${id}`, { method: "DELETE" });
  revalidatePath("/admin/integrations");
}
