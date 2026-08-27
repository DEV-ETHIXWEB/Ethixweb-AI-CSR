"use client";

import { useActionState } from "react";
import type { CapacityConfig } from "@/lib/capacity-config-types";
import { updateCapacityConfig, type UpdateCapacityConfigState } from "./actions";

const INITIAL_STATE: UpdateCapacityConfigState = { ok: false, error: null };

/** Owner/admin-only write form — RBAC is enforced by core-api's own @Roles("owner","admin") on the PATCH route; this form has no client-side role gate of its own since the page that renders it already only links here from behind that same role check, and a dispatcher/viewer submitting anyway would simply get a real 403 from the action above. */
export function CapacityForm({
  businessId,
  config,
}: {
  businessId: string;
  config: CapacityConfig;
}) {
  const action = updateCapacityConfig.bind(null, businessId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} style={{ maxWidth: 480 }}>
      {state.error ? (
        <div style={errorBoxStyle}>{state.error}</div>
      ) : state.ok ? (
        <div style={successBoxStyle}>Saved.</div>
      ) : null}

      <Field
        label="Max concurrent calls (this business)"
        name="maxTenantConcurrentCalls"
        type="number"
        defaultValue={config.maxTenantConcurrentCalls}
        min={1}
      />
      <Field
        label="Max waiting callers"
        name="maxWaitingCallers"
        type="number"
        defaultValue={config.maxWaitingCallers}
        min={0}
      />
      <Field
        label="Waiting timeout (ms)"
        name="waitingTimeoutMs"
        type="number"
        defaultValue={config.waitingTimeoutMs}
        min={0}
      />
      <Field
        label="Emergency headroom ratio (0–1)"
        name="emergencyHeadroomRatio"
        type="number"
        defaultValue={config.emergencyHeadroomRatio}
        min={0}
        max={1}
        step={0.05}
      />
      <Field
        label="Overflow number (E.164, optional)"
        name="overflowNumber"
        type="text"
        defaultValue={config.overflowNumber ?? ""}
      />

      <label style={checkboxRowStyle}>
        <input type="checkbox" name="brochureEnabled" defaultChecked={config.brochureEnabled} />
        Waiting brochure enabled
      </label>

      <Field
        label="Brochure rotation interval (ms)"
        name="brochureRotationMs"
        type="number"
        defaultValue={config.brochureRotationMs}
        min={0}
      />

      <button type="submit" disabled={pending} style={submitButtonStyle}>
        {pending ? "Saving…" : "Save configuration"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type,
  defaultValue,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type: "number" | "text";
  defaultValue: string | number;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor={name} style={labelStyle}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        min={min}
        max={max}
        step={step}
        style={inputStyle}
      />
    </div>
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
  fontFamily: "inherit",
};

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "0.85rem",
  marginBottom: 16,
};

const submitButtonStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontSize: "0.85rem",
  fontWeight: 600,
  cursor: "pointer",
};

const errorBoxStyle: React.CSSProperties = {
  background: "var(--danger-soft)",
  color: "var(--danger)",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: "0.8rem",
  marginBottom: 16,
};

const successBoxStyle: React.CSSProperties = {
  background: "var(--accent-soft)",
  color: "var(--accent)",
  padding: "8px 12px",
  borderRadius: 6,
  fontSize: "0.8rem",
  marginBottom: 16,
};
