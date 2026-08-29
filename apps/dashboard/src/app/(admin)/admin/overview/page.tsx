import { HealthPill } from "@/components/health-pill";
import { StatCard } from "@/components/stat-card";
import { coreApiFetch } from "@/lib/core-api-client";
import type { DashboardHealth, DashboardOverview } from "@/lib/dashboard-types";

const HEALTH_LABELS: Record<keyof DashboardHealth, string> = {
  database: "Database",
  voiceOrchestrator: "Voice Orchestrator",
  redis: "Redis",
  hcp: "HCP / CRM",
  telephony: "Telephony",
  stt: "Speech-to-Text",
  tts: "Text-to-Speech",
  llm: "LLM",
};

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Overview</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const [overview, health] = await Promise.all([
    coreApiFetch<DashboardOverview>(`/dashboard/overview?businessId=${businessId}`),
    coreApiFetch<DashboardHealth>("/dashboard/health"),
  ]);

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Overview</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 24 }}>
        Snapshot for this business — near-real-time, not a live feed.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        <StatCard
          label="Active calls"
          value={String(overview.activeCallsCount)}
          caption="Postgres proxy — see caption below"
        />
        <StatCard label="Calls today" value={String(overview.callsToday)} />
        <StatCard label="Leads today" value={String(overview.leadsCapturedToday)} />
        <StatCard
          label="Capacity utilization"
          value={`${Math.round(overview.capacityUtilization * 100)}%`}
        />
        <StatCard label="CRM integration" value={overview.integrationStatus} />
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginTop: 8 }}>
        Active-call and capacity figures are derived from Postgres <code>Call</code> rows, not
        voice-orchestrator&apos;s live Redis reservation counter — they can lag the true in-flight
        count by the time it takes each side&apos;s write to land (docs/37 §4).
      </p>

      <h2 style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 32, marginBottom: 8 }}>
        Usage today
      </h2>
      {overview.usageToday.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
          No usage recorded yet today.
        </p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 480 }}>
          <thead>
            <tr>
              <th style={tableHeadStyle}>Type</th>
              <th style={tableHeadStyle}>Quantity</th>
              <th style={tableHeadStyle}>Unit</th>
              <th style={tableHeadStyle}>Records</th>
            </tr>
          </thead>
          <tbody>
            {overview.usageToday.map((row) => (
              <tr key={row.usageType}>
                <td style={tableCellStyle}>{row.usageType}</td>
                <td style={{ ...tableCellStyle, fontVariantNumeric: "tabular-nums" }}>
                  {row.totalQuantity}
                </td>
                <td style={tableCellStyle}>{row.unit}</td>
                <td style={{ ...tableCellStyle, fontVariantNumeric: "tabular-nums" }}>
                  {row.recordCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ fontSize: "0.92rem", fontWeight: 700, marginTop: 32, marginBottom: 8 }}>
        System health
      </h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(HEALTH_LABELS) as (keyof DashboardHealth)[]).map((key) => (
          <div key={key} style={healthRowStyle}>
            <span>{HEALTH_LABELS[key]}</span>
            <HealthPill status={health[key]} />
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginTop: 8 }}>
        Only Database is genuinely observed from core-api. Every other component reports Unknown by
        design — core-api has no connection to voice-orchestrator, Redis (a separate instance), HCP,
        or any telephony/STT/TTS/LLM vendor to check from where it sits (docs/37 §6).
      </p>
    </div>
  );
}

const tableHeadStyle: React.CSSProperties = {
  textAlign: "left",
  fontSize: "0.7rem",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--ink-faint)",
  borderBottom: "1px solid var(--border-soft)",
  padding: "8px 10px",
};

const tableCellStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  borderBottom: "1px solid var(--border-soft)",
  padding: "8px 10px",
};

const healthRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  background: "var(--surface)",
  border: "1px solid var(--border-soft)",
  borderRadius: "var(--radius-sm)",
  boxShadow: "var(--shadow-sm)",
  padding: "9px 13px",
  minWidth: 200,
  fontSize: "0.82rem",
};
