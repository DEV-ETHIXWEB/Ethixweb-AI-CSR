import Link from "next/link";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusPill } from "@/components/status-pill";
import { tableStyles } from "@/components/data-table.css";
import { coreApiFetch } from "@/lib/core-api-client";
import type { PaginatedNotifications } from "@/lib/notifications-types";
import { RequeueButton } from "./requeue-button";

const PAGE_SIZE = 20;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; page?: string }>;
}) {
  const { businessId, page } = await searchParams;
  const currentPage = Number(page ?? "1");

  const result = await coreApiFetch<PaginatedNotifications>(
    `/notifications/dead-letter?page=${currentPage}&pageSize=${PAGE_SIZE}`,
  );

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Notifications</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 8 }}>
        Dead Letter Queue — notifications that exhausted their retry budget and need manual
        attention.
      </p>
      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginBottom: 20 }}>
        This is tenant-wide, not filterable by business — the real backend endpoint (
        <code>GET /notifications/dead-letter</code>) has no <code>businessId</code> parameter. A
        general &quot;all sent notifications for this business&quot; view also does not exist today;
        the only other read endpoint (<code>GET /notifications?leadId=</code>) requires a specific
        lead — visible from each lead&apos;s own detail page rather than duplicated here. Showing
        the honest scope of what exists rather than fabricating a business-scoped filter.
      </p>

      <div style={tableStyles.wrapper}>
        <table style={tableStyles.table}>
          <thead>
            <tr>
              <th style={tableStyles.head}>Channel</th>
              <th style={tableStyles.head}>Status</th>
              <th style={tableStyles.head}>Attempts</th>
              <th style={tableStyles.head}>Created</th>
              <th style={tableStyles.head}>Lead</th>
              <th style={tableStyles.head}>Action</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td style={tableStyles.emptyState} colSpan={6}>
                  Dead Letter Queue is empty — nothing needs manual attention.
                </td>
              </tr>
            ) : (
              result.items.map((n) => (
                <tr key={n.id}>
                  <td style={tableStyles.cell}>{n.channelType}</td>
                  <td style={tableStyles.cell}>
                    <StatusPill label={n.status} tone="danger" />
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {n.attemptCount}
                  </td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {new Date(n.createdAt).toLocaleString()}
                  </td>
                  <td style={tableStyles.cell}>
                    <Link
                      href={`/admin/leads/${n.leadId}${businessId ? `?businessId=${businessId}` : ""}`}
                    >
                      View lead
                    </Link>
                  </td>
                  <td style={tableStyles.cell}>
                    <RequeueButton notificationId={n.id} />
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
