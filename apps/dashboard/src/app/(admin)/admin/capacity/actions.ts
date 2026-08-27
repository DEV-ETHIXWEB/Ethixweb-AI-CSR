"use server";

import { revalidatePath } from "next/cache";
import { coreApiFetch } from "@/lib/core-api-client";
import type { CapacityConfig } from "@/lib/capacity-config-types";

export interface UpdateCapacityConfigState {
  ok: boolean;
  error: string | null;
}

/**
 * Server Action, not a client-side fetch to a Route Handler — this
 * mutation only ever runs server-side (Next.js's own guarantee for
 * "use server" functions), so it goes through coreApiFetch directly,
 * the same server-only authenticated client every Server Component page
 * already uses. tenantId/businessId are never read from the submitted
 * form — businessId comes from the already-validated URL param the page
 * itself resolved, tenantId is derived entirely server-side from the
 * session cookie inside coreApiFetch/getSession, never trusted from the
 * browser.
 */
export async function updateCapacityConfig(
  businessId: string,
  _prevState: UpdateCapacityConfigState,
  formData: FormData,
): Promise<UpdateCapacityConfigState> {
  const patch = {
    maxTenantConcurrentCalls: toNumber(formData.get("maxTenantConcurrentCalls")),
    maxWaitingCallers: toNumber(formData.get("maxWaitingCallers")),
    waitingTimeoutMs: toNumber(formData.get("waitingTimeoutMs")),
    emergencyHeadroomRatio: toNumber(formData.get("emergencyHeadroomRatio")),
    overflowNumber: toStringOrNull(formData.get("overflowNumber")),
    brochureEnabled: formData.get("brochureEnabled") === "on",
    brochureRotationMs: toNumber(formData.get("brochureRotationMs")),
  };

  try {
    await coreApiFetch<CapacityConfig>(`/dashboard/capacity-config/${businessId}`, {
      method: "PATCH",
      body: patch,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Update failed." };
  }

  revalidatePath("/admin/capacity");
  return { ok: true, error: null };
}

function toNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toStringOrNull(value: FormDataEntryValue | null): string | null | undefined {
  if (value === null) {
    return undefined;
  }
  const str = String(value).trim();
  return str === "" ? null : str;
}
