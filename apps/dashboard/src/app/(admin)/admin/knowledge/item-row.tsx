"use client";

import { useState, useTransition } from "react";
import { StatusPill } from "@/components/status-pill";
import type { KnowledgeItem } from "@/lib/knowledge-types";
import { approveKnowledgeItem, disableKnowledgeItem } from "./actions";

const STATUS_TONE = { draft: "warn", approved: "ok", disabled: "unknown" } as const;

export function KnowledgeItemRow({ item }: { item: KnowledgeItem }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      try {
        await approveKnowledgeItem(item.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Approve failed.");
      }
    });
  }

  function handleDisable() {
    setError(null);
    startTransition(async () => {
      try {
        await disableKnowledgeItem(item.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Disable failed.");
      }
    });
  }

  return (
    <div style={rowStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              fontSize: "0.88rem",
              fontWeight: 600,
            }}
          >
            {item.title}
          </button>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginTop: 2 }}>
            {item.category}
            {item.aiKnowledge ? " · AI Knowledge" : ""}
            {item.waitingBrochure ? " · Waiting Brochure" : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
          <StatusPill label={item.status} tone={STATUS_TONE[item.status]} />
          {item.status === "draft" ? (
            <button onClick={handleApprove} disabled={isPending} style={approveButtonStyle}>
              Approve
            </button>
          ) : null}
          {item.status !== "disabled" ? (
            <button onClick={handleDisable} disabled={isPending} style={disableButtonStyle}>
              Disable
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div style={errorTextStyle}>{error}</div> : null}

      {expanded ? (
        <div style={{ marginTop: 10, fontSize: "0.82rem", color: "var(--ink)" }}>
          <p style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>{item.content}</p>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
            Priority {item.priority} · Updated {new Date(item.updatedAt).toLocaleString()}
            {item.approvedAt ? ` · Approved ${new Date(item.approvedAt).toLocaleString()}` : ""}
          </div>
        </div>
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

const approveButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "0.72rem",
  fontWeight: 600,
  border: "1px solid var(--accent)",
  background: "var(--accent-soft)",
  color: "var(--accent)",
  borderRadius: 6,
  cursor: "pointer",
};

const disableButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "0.72rem",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--ink-soft)",
  borderRadius: 6,
  cursor: "pointer",
};

const errorTextStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "0.75rem",
  marginTop: 6,
};
