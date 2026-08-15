import Link from "next/link";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusPill } from "@/components/status-pill";
import { tableStyles } from "@/components/data-table.css";
import { coreApiFetch } from "@/lib/core-api-client";
import type { LeadPriority, LeadStatus, PaginatedLeads } from "@/lib/leads-types";

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  notified: "Notified",
  claimed: "Claimed",
  converted_to_job: "Converted",
  expired: "Expired",
  duplicate: "Duplicate",
  abandoned: "Abandoned",
};

const STATUS_TONE: Record<LeadStatus, "ok" | "warn" | "danger" | "unknown"> = {
  new: "ok",
  notified: "warn",
  claimed: "ok",
  converted_to_job: "ok",
  expired: "unknown",
  duplicate: "unknown",
  abandoned: "danger",
};

const PRIORITY_TONE: Record<LeadPriority, "ok" | "warn" | "danger" | "unknown"> = {
  emergency: "danger",
  urgent: "warn",
  routine: "unknown",
  estimate: "unknown",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    businessId?: string;
    status?: LeadStatus;
    priority?: string;
    page?: string;
  }>;
}) {
  const { businessId, status, priority, page } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Leads</h1>
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
  if (status) query.set("status", status);
  if (priority) query.set("priority", priority);

  const result = await coreApiFetch<PaginatedLeads>(`/leads?${query.toString()}`);

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Leads</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 16 }}>
        Dispatcher inbox for this business.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(["new", "notified", "claimed", "converted_to_job"] as LeadStatus[]).map((s) => {
          const params = new URLSearchParams({ businessId });
          if (status !== s) params.set("status", s);
          if (priority) params.set("priority", priority);
          const isActive = status === s;
          return (
            <Link
              key={s}
              href={`/admin/leads?${params.toString()}`}
              style={filterLinkStyle(isActive)}
            >
              {STATUS_LABEL[s]}
            </Link>
          );
        })}
        {status || priority ? (
          <Link
            href={`/admin/leads?businessId=${businessId}`}
            style={{ fontSize: "0.78rem", color: "var(--ink-soft)", alignSelf: "center" }}
          >
            Clear filters
          </Link>
        ) : null}
      </div>

      <div style={tableStyles.wrapper}>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.head}>Problem</th>
              <th style={tableStyles.head}>Priority</th>
              <th style={tableStyles.head}>Type</th>
              <th style={tableStyles.head}>Status</th>
              <th style={tableStyles.head}>Created</th>
              <th style={tableStyles.head}>Lead ID</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td style={tableStyles.emptyState} colSpan={6}>
                  No leads match this filter yet.
                </td>
              </tr>
            ) : (
              result.items.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ ...tableStyles.cell, maxWidth: 320 }}>
                    <Link
                      href={`/admin/leads/${lead.id}?businessId=${businessId}`}
                      style={{ color: "var(--ink)", fontWeight: 500 }}
                    >
                      {lead.problemSummary}
                    </Link>
                  </td>
                  <td style={tableStyles.cell}>
                    <StatusPill
                      label={lead.priority}
                      tone={PRIORITY_TONE[lead.priority as LeadPriority] ?? "unknown"}
                    />
                  </td>
                  <td style={tableStyles.cell}>{lead.leadType}</td>
                  <td style={tableStyles.cell}>
                    <StatusPill label={STATUS_LABEL[lead.status]} tone={STATUS_TONE[lead.status]} />
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {new Date(lead.createdAt).toLocaleString()}
                  </td>
                  <td
                    style={{
                      ...tableStyles.cell,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.75rem",
                    }}
                  >
                    {lead.id}
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

function filterLinkStyle(isActive: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: "0.78rem",
    border: "1px solid var(--border)",
    background: isActive ? "var(--accent-soft)" : "var(--surface)",
    color: isActive ? "var(--accent)" : "var(--ink)",
    textDecoration: "none",
  };
}
