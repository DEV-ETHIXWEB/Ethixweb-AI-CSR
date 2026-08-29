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
            <button
              onClick={handleApprove}
              disabled={isPending}
              className="clay-btn clay-btn-primary"
              style={approveButtonStyle}
            >
              Approve
            </button>
          ) : null}
          {item.status !== "disabled" ? (
            <button
              onClick={handleDisable}
              disabled={isPending}
              className="clay-btn clay-btn-secondary"
              style={disableButtonStyle}
            >
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
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
  padding: "13px 15px",
  marginBottom: 10,
};

const approveButtonStyle: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: "0.72rem",
};

const disableButtonStyle: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: "0.72rem",
  color: "var(--ink-soft)",
};

const errorTextStyle: React.CSSProperties = {
  color: "var(--danger)",
  fontSize: "0.75rem",
  marginTop: 6,
};
