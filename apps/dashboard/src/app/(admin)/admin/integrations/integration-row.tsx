"use client";

import { useState, useTransition } from "react";
import { StatusPill } from "@/components/status-pill";
import type { Integration } from "@/lib/integrations-types";
import { disconnectIntegration, verifyIntegration } from "./actions";

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "unknown"> = {
  active: "ok",
  pending_verification: "warn",
  invalid_credentials: "danger",
  disconnected: "unknown",
};

/** Only ever renders a status/tone the backend itself reported — never assumes "connected" beyond what integration.status literally says (per the explicit "do not display integrations as connected unless the backend confirms it" instruction). */
export function IntegrationRow({ integration }: { integration: Integration }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(integration);

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      try {
        const updated = await verifyIntegration(current.id);
        setCurrent(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verification failed.");
      }
    });
  }

  function handleDisconnect() {
    setError(null);
    startTransition(async () => {
      try {
        await disconnectIntegration(current.id);
        setCurrent({ ...current, status: "disconnected" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Disconnect failed.");
      }
    });
  }

  return (
    <div style={rowStyle}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
      >
        <div>
          <div style={{ fontSize: "0.88rem", fontWeight: 600 }}>{current.crmType}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginTop: 2 }}>
            {current.lastVerifiedAt
              ? `Last verified ${new Date(current.lastVerifiedAt).toLocaleString()}`
              : "Never verified"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusPill label={current.status} tone={STATUS_TONE[current.status] ?? "unknown"} />
          {current.status !== "disconnected" ? (
            <>
              <button onClick={handleVerify} disabled={isPending} style={verifyButtonStyle}>
                Verify
              </button>
              <button onClick={handleDisconnect} disabled={isPending} style={disconnectButtonStyle}>
                Disconnect
              </button>
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <div style={{ color: "var(--danger)", fontSize: "0.75rem", marginTop: 6 }}>{error}</div>
      ) : null}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "12px 14px",
  marginBottom: 8,
};

const verifyButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "0.72rem",
  fontWeight: 600,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  borderRadius: 6,
  cursor: "pointer",
};

const disconnectButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "0.72rem",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--danger)",
  borderRadius: 6,
  cursor: "pointer",
};
