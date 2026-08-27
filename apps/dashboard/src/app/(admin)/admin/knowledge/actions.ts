"use server";

import { revalidatePath } from "next/cache";
import { coreApiFetch } from "@/lib/core-api-client";
import type { KnowledgeItem } from "@/lib/knowledge-types";

export interface ActionState {
  ok: boolean;
  error: string | null;
}

const INITIAL: ActionState = { ok: false, error: null };

/**
 * Every mutation here goes through coreApiFetch — server-only, session
 * cookie-derived auth, never a client-supplied tenantId/businessId for
 * authorization (businessId IS sent, since the backend routes require it
 * in the URL, but it's core-api's own @Roles("owner","admin") + RLS that
 * actually enforces the caller may act on it, not anything checked here).
 * All four actions preserve the exact approval lifecycle already built
 * server-side (docs/38) — this file invents no new business logic, only
 * forwards form input to the real endpoints.
 */
export async function createKnowledgeItem(
  businessId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await coreApiFetch<KnowledgeItem>("/dashboard/knowledge", {
      method: "POST",
      body: {
        businessId,
        category: String(formData.get("category") ?? ""),
        title: String(formData.get("title") ?? ""),
        content: String(formData.get("content") ?? ""),
        aiKnowledge: formData.get("aiKnowledge") === "on",
        waitingBrochure: formData.get("waitingBrochure") === "on",
        priority: Number(formData.get("priority") ?? 0),
      },
    });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  revalidatePath("/admin/knowledge");
  return { ...INITIAL, ok: true };
}

export async function updateKnowledgeItem(
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    await coreApiFetch<KnowledgeItem>(`/dashboard/knowledge/${itemId}`, {
      method: "PATCH",
      body: {
        category: String(formData.get("category") ?? ""),
        title: String(formData.get("title") ?? ""),
        content: String(formData.get("content") ?? ""),
        aiKnowledge: formData.get("aiKnowledge") === "on",
        waitingBrochure: formData.get("waitingBrochure") === "on",
        priority: Number(formData.get("priority") ?? 0),
      },
    });
  } catch (error) {
    return { ok: false, error: message(error) };
  }
  revalidatePath("/admin/knowledge");
  return { ...INITIAL, ok: true };
}

export async function approveKnowledgeItem(itemId: string): Promise<void> {
  await coreApiFetch(`/dashboard/knowledge/${itemId}/approve`, { method: "POST" });
  revalidatePath("/admin/knowledge");
}

export async function disableKnowledgeItem(itemId: string): Promise<void> {
  await coreApiFetch(`/dashboard/knowledge/${itemId}/disable`, { method: "POST" });
  revalidatePath("/admin/knowledge");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
