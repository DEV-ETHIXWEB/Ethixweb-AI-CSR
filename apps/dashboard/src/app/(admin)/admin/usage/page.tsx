import Link from "next/link";
import { tableStyles } from "@/components/data-table.css";
import { coreApiFetch } from "@/lib/core-api-client";
import type { UsageSummary } from "@/lib/usage-types";

type Range = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90 };
const RANGE_LABEL: Record<Range, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
};

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; range?: Range }>;
}) {
  const { businessId, range } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Usage</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const activeRange: Range = range && range in RANGE_DAYS ? range : "30d";
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_DAYS[activeRange] * 24 * 60 * 60 * 1000);

  const query = new URLSearchParams({
    businessId,
    from: from.toISOString(),
    to: to.toISOString(),
  });
  const summary = await coreApiFetch<UsageSummary>(`/usage/summary?${query.toString()}`);

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Usage</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 8 }}>
        Deterministic usage totals from persisted records — recomputed live on every request, not
        cached or pre-aggregated.
      </p>
      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginBottom: 20 }}>
        Only <code>voice_call_duration</code> is actually recorded today (docs/27 §2.1) —{" "}
        <code>llm_tokens</code>/<code>stt_duration</code>/<code>tts_characters</code> are honestly
        absent because no part of the current AI-provider/voice-runtime integration reports that
        data yet, not filtered out here.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["7d", "30d", "90d"] as Range[]).map((r) => (
          <Link
            key={r}
            href={`/admin/usage?businessId=${businessId}&range=${r}`}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.78rem",
              fontWeight: activeRange === r ? 700 : 500,
              border: `1px solid ${activeRange === r ? "transparent" : "var(--border)"}`,
              background: activeRange === r ? "var(--primary-soft)" : "var(--surface)",
              color: activeRange === r ? "var(--primary)" : "var(--ink-soft)",
              boxShadow: activeRange === r ? "inset 0 1px oklch(100% 0 0 / .6)" : "none",
              textDecoration: "none",
            }}
          >
            {RANGE_LABEL[r]}
          </Link>
        ))}
      </div>

      <div style={tableStyles.wrapper}>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.head}>Type</th>
              <th style={tableStyles.head}>Total quantity</th>
              <th style={tableStyles.head}>Unit</th>
              <th style={tableStyles.head}>Records</th>
              <th style={tableStyles.head}>Est. provider cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {summary.totals.length === 0 ? (
              <tr>
                <td style={tableStyles.emptyState} colSpan={5}>
                  No usage recorded for this period.
                </td>
              </tr>
            ) : (
              summary.totals.map((row) => (
                <tr key={row.usageType}>
                  <td style={tableStyles.cell}>{row.usageType}</td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {row.totalQuantity.toLocaleString()}
                  </td>
                  <td style={tableStyles.cell}>{row.unit}</td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {row.recordCount}
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {row.totalEstimatedProviderCostUsd ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: "0.7rem", color: "var(--ink-soft)", marginTop: 10 }}>
        {new Date(summary.from).toLocaleDateString()} – {new Date(summary.to).toLocaleDateString()}
      </p>
    </div>
  );
}
