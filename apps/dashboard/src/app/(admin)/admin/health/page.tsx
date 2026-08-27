import { HealthPill } from "@/components/health-pill";
import { coreApiFetch } from "@/lib/core-api-client";
import type { DashboardHealth } from "@/lib/dashboard-types";

const COMPONENTS: Array<{
  key: keyof DashboardHealth;
  label: string;
  note: string;
}> = [
  {
    key: "database",
    label: "Database",
    note: "Genuinely checked — a live SELECT 1 against core-api's own PostgreSQL connection.",
  },
  {
    key: "voiceOrchestrator",
    label: "Voice Orchestrator",
    note: "core-api has no outbound connection to voice-orchestrator's health endpoint — deliberately not added, to avoid a new cross-service dependency on this read path (docs/37 §6).",
  },
  {
    key: "redis",
    label: "Redis",
    note: "core-api's own Redis usage is unrelated to voice-orchestrator's separate Redis instance — neither is checked here.",
  },
  {
    key: "hcp",
    label: "HCP / CRM",
    note: "No live connectivity check exists for CRM integrations from this endpoint — see the Integrations page for per-integration verification status instead.",
  },
  {
    key: "telephony",
    label: "Telephony",
    note: "External to this repository — Yash's voice runtime, which does not exist yet.",
  },
  {
    key: "stt",
    label: "Speech-to-Text",
    note: "Same as Telephony — part of the not-yet-built voice runtime.",
  },
  {
    key: "tts",
    label: "Text-to-Speech",
    note: "Same as Telephony — part of the not-yet-built voice runtime.",
  },
  {
    key: "llm",
    label: "LLM",
    note: "voice-orchestrator's own AI-provider adapters are not checked from core-api's health endpoint.",
  },
];

export default async function HealthPage() {
  const health = await coreApiFetch<DashboardHealth>("/dashboard/health");
  const checkedAt = new Date();

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>System Health</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 4 }}>
        Checked as of {checkedAt.toLocaleString()} — this reflects core-api&apos;s own health
        endpoint, refreshed on page load, not a live/streaming feed.
      </p>
      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginBottom: 24 }}>
        &quot;Unknown&quot; is never rendered as healthy — it means core-api genuinely cannot
        observe that component from where it runs, not that it hasn&apos;t been checked yet.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {COMPONENTS.map((c) => (
          <div key={c.key} style={rowStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "0.88rem", fontWeight: 600 }}>{c.label}</span>
              <HealthPill status={health[c.key]} />
            </div>
            <p
              style={{
                fontSize: "0.75rem",
                color: "var(--ink-soft)",
                marginTop: 4,
                marginBottom: 0,
              }}
            >
              {c.note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "12px 16px",
};
