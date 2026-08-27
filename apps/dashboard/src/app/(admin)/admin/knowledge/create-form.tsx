"use client";

import { useActionState, useRef, useEffect } from "react";
import { createKnowledgeItem, type ActionState } from "./actions";

const INITIAL_STATE: ActionState = { ok: false, error: null };

/** New items always start in draft server-side (defense-in-depth confirmed in docs/38 — three independent layers, not just this form) — there is deliberately no status field here to submit. */
export function CreateKnowledgeForm({ businessId }: { businessId: string }) {
  const action = createKnowledgeItem.bind(null, businessId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} style={{ maxWidth: 520, marginBottom: 32 }}>
      <h2 style={{ fontSize: "0.92rem", fontWeight: 700, marginBottom: 10 }}>Add knowledge item</h2>

      {state.error ? <div style={errorStyle}>{state.error}</div> : null}
      {state.ok ? (
        <div style={successStyle}>Added as draft — approve it below to make it live.</div>
      ) : null}

      <div style={rowStyle}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="category">
            Category
          </label>
          <input id="category" name="category" required style={inputStyle} placeholder="Services" />
        </div>
        <div style={{ flex: 2 }}>
          <label style={labelStyle} htmlFor="title">
            Title
          </label>
          <input id="title" name="title" required style={inputStyle} placeholder="Drain cleaning" />
        </div>
      </div>

      <label style={labelStyle} htmlFor="content">
        Content
      </label>
      <textarea
        id="content"
        name="content"
        required
        rows={3}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        placeholder="We provide same-day drain cleaning across the metro area."
      />

      <div style={{ display: "flex", gap: 16, margin: "10px 0 14px" }}>
        <label style={checkboxStyle}>
          <input type="checkbox" name="aiKnowledge" /> AI Knowledge
        </label>
        <label style={checkboxStyle}>
          <input type="checkbox" name="waitingBrochure" /> Waiting Brochure
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label htmlFor="priority" style={{ fontSize: "0.8rem" }}>
            Priority
          </label>
          <input
            id="priority"
            name="priority"
            type="number"
            defaultValue={0}
            min={0}
            style={{ ...inputStyle, width: 64 }}
          />
        </div>
      </div>

      <button type="submit" disabled={pending} style={submitStyle}>
        {pending ? "Adding…" : "Add as draft"}
      </button>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: "0.85rem",
  marginBottom: 10,
};
const rowStyle: React.CSSProperties = { display: "flex", gap: 12 };
const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: "0.8rem",
};
const submitStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: "0.85rem",
  fontWeight: 600,
  cursor: "pointer",
};
const errorStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: "0.8rem",
  marginBottom: 10,
};
const successStyle: React.CSSProperties = {
  background: "var(--accent-soft)",
  color: "var(--accent)",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: "0.8rem",
  marginBottom: 10,
};
