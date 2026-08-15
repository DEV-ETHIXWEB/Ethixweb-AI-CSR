"use server";

import { revalidatePath } from "next/cache";
import { coreApiFetch } from "@/lib/core-api-client";
import type { RequeueOutcome } from "@/lib/notifications-types";

export async function requeueNotification(id: string): Promise<RequeueOutcome> {
  const outcome = await coreApiFetch<RequeueOutcome>(`/notifications/${id}/requeue`, {
    method: "POST",
  });
  revalidatePath("/admin/notifications");
  return outcome;
}
