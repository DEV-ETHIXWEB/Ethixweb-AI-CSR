"use client";

import { useState, useTransition } from "react";
import { requeueNotification } from "./actions";

export function RequeueButton({ notificationId }: { notificationId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ success: boolean; error: string | null } | null>(null);

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await requeueNotification(notificationId);
        setResult({ success: outcome.success, error: outcome.error });
      } catch (e) {
        setResult({ success: false, error: e instanceof Error ? e.message : "Requeue failed." });
      }
    });
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="clay-btn clay-btn-primary"
        style={buttonStyle}
      >
        {isPending ? "Retrying…" : "Requeue"}
      </button>
      {result ? (
        <div
          style={{
            fontSize: "0.7rem",
            marginTop: 4,
            fontWeight: 600,
            color: result.success ? "var(--success)" : "var(--danger)",
          }}
        >
          {result.success ? "Sent" : (result.error ?? "Failed")}
        </div>
      ) : null}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: "0.72rem",
};
