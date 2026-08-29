"use client";

import { useActionState, useRef, useEffect } from "react";
import { CRM_TYPES } from "@/lib/integrations-types";
import { connectIntegration, type ActionState } from "./actions";

const INITIAL_STATE: ActionState = { ok: false, error: null };

export function ConnectIntegrationForm({ businessId }: { businessId: string }) {
  const action = connectIntegration.bind(null, businessId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} style={{ maxWidth: 420, marginBottom: 28 }}>
      <h2 style={{ fontSize: "0.92rem", fontWeight: 700, marginBottom: 10 }}>Connect a CRM</h2>

      {state.error ? <div style={errorStyle}>{state.error}</div> : null}
      {state.ok ? (
        <div style={successStyle}>
          Connected. Click Verify below to confirm the credential works.
        </div>
      ) : null}

      <label style={labelStyle} htmlFor="crmType">
        CRM
      </label>
      <select id="crmType" name="crmType" required className="clay-input" style={inputStyle}>
        {CRM_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <label style={labelStyle} htmlFor="apiKey">
        API key
      </label>
      <input
        id="apiKey"
        name="apiKey"
        type="password"
        required
        autoComplete="off"
        className="clay-input"
        style={inputStyle}
      />
      <input type="hidden" name="credentialType" value="api_key" />

      <label style={labelStyle} htmlFor="baseUrl">
        Base URL override (optional, e.g. sandbox)
      </label>
      <input id="baseUrl" name="baseUrl" type="text" className="clay-input" style={inputStyle} />

      <button
        type="submit"
        disabled={pending}
        className="clay-btn clay-btn-primary"
        style={submitStyle}
      >
        {pending ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 600,
  marginBottom: 4,
  marginTop: 10,
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 11px",
  fontSize: "0.85rem",
  fontFamily: "inherit",
};
const submitStyle: React.CSSProperties = {
  marginTop: 14,
  padding: "9px 16px",
  fontSize: "0.85rem",
};
const errorStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  padding: "9px 12px",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.8rem",
  marginBottom: 10,
};
const successStyle: React.CSSProperties = {
  background: "var(--success-soft)",
  color: "var(--success)",
  padding: "9px 12px",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.8rem",
  marginBottom: 10,
};
