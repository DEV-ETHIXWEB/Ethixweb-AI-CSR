import Link from "next/link";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusPill } from "@/components/status-pill";
import { tableStyles } from "@/components/data-table.css";
import { coreApiFetch } from "@/lib/core-api-client";
import type { CallStatus, PaginatedCalls } from "@/lib/calls-types";

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<CallStatus, string> = {
  in_progress: "In progress",
  completed: "Completed",
  abandoned: "Abandoned",
};

const STATUS_TONE: Record<CallStatus, "ok" | "warn" | "unknown"> = {
  in_progress: "ok",
  completed: "unknown",
  abandoned: "warn",
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; status?: CallStatus; page?: string }>;
}) {
  const { businessId, status, page } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Live Calls</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const currentPage = Number(page ?? "1");
  const query = new URLSearchParams({
    businessId,
    page: String(currentPage),
    pageSize: String(PAGE_SIZE),
  });
  if (status) {
    query.set("status", status);
  }

  const result = await coreApiFetch<PaginatedCalls>(`/calls?${query.toString()}`);

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Live Calls</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 8 }}>
        Call inbox for this business — a near-real-time snapshot from the database, refreshed on
        page load, not a live/streaming feed. There is no field marking a call as
        &quot;emergency-priority&quot; or carrying its transfer state yet (no schema column exists
        for either — docs/37 §5&apos;s honest-gap note applies here too); once one exists, it will
        surface here without any change to this page.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {(["in_progress", "completed", "abandoned"] as CallStatus[]).map((s) => {
          const params = new URLSearchParams({ businessId });
          if (status !== s) {
            params.set("status", s);
          }
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/admin/calls?${params.toString()}`}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                fontSize: "0.78rem",
                fontWeight: isActive ? 700 : 500,
                border: `1px solid ${isActive ? "transparent" : "var(--border)"}`,
                background: isActive ? "var(--primary-soft)" : "var(--surface)",
                color: isActive ? "var(--primary)" : "var(--ink-soft)",
                boxShadow: isActive ? "inset 0 1px oklch(100% 0 0 / .6)" : "none",
                textDecoration: "none",
              }}
            >
              {STATUS_LABEL[s]}
            </Link>
          );
        })}
        {status ? (
          <Link
            href={`/admin/calls?businessId=${businessId}`}
            style={{ fontSize: "0.78rem", color: "var(--ink-soft)", alignSelf: "center" }}
          >
            Clear filter
          </Link>
        ) : null}
      </div>

      <div style={tableStyles.wrapper}>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.head}>Caller</th>
              <th style={tableStyles.head}>Direction</th>
              <th style={tableStyles.head}>Status</th>
              <th style={tableStyles.head}>Started</th>
              <th style={tableStyles.head}>Duration</th>
              <th style={tableStyles.head}>End reason</th>
              <th style={tableStyles.head}>Call ID</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td style={tableStyles.emptyState} colSpan={7}>
                  No calls match this filter yet.
                </td>
              </tr>
            ) : (
              result.items.map((call) => (
                <tr key={call.id}>
                  <td style={tableStyles.cell}>{call.fromNumber}</td>
                  <td style={tableStyles.cell}>{call.direction}</td>
                  <td style={tableStyles.cell}>
                    <StatusPill label={STATUS_LABEL[call.status]} tone={STATUS_TONE[call.status]} />
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {new Date(call.startedAt).toLocaleString()}
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {formatDuration(call.durationSeconds)}
                  </td>
                  <td style={tableStyles.cell}>{call.endReason ?? "—"}</td>
                  <td
                    style={{
                      ...tableStyles.cell,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {call.id}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaginationControls total={result.total} pageSize={PAGE_SIZE} />
    </div>
  );
}
