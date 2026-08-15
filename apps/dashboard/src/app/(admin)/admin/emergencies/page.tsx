import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { tableStyles } from "@/components/data-table.css";
import { coreApiFetch } from "@/lib/core-api-client";
import type { DashboardEmergencies } from "@/lib/emergencies-types";

export default async function EmergenciesPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Emergencies</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const result = await coreApiFetch<DashboardEmergencies>(
    `/dashboard/emergencies?businessId=${businessId}`,
  );

  return (
    <div>
      <h1
        style={{
          fontSize: "1.15rem",
          fontWeight: 700,
          marginBottom: 4,
          color: "var(--danger)",
        }}
      >
        Emergencies
      </h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 20 }}>
        Historical emergency escalations for this business.
      </p>

      {result.items.length === 0 ? (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "24px 20px",
          }}
        >
          <p style={{ fontSize: "0.85rem", marginBottom: 8 }}>No emergency escalations recorded.</p>
          <p style={{ fontSize: "0.75rem", color: "var(--ink-soft)", lineHeight: 1.6 }}>
            This is a genuine backend limitation, not a filter or a loading gap: no schema field
            currently marks a call or lead as emergency-escalated (
            <code>ListDashboardEmergenciesUseCase</code> always returns an empty result — docs/37
            §5). Emergency detection itself works during a live call (a business&apos;s configured
            <code> EmergencyRule</code>s still fail safely toward escalation), but that
            classification is not persisted anywhere queryable today. This page is wired to the real
            endpoint and will populate automatically the moment that gap is closed elsewhere — no
            frontend change will be needed.
          </p>
        </div>
      ) : (
        <div style={tableStyles.wrapper}>
          <table style={tableStyles.table}>
            <thead>
              <tr>
                <th style={tableStyles.head}>Severity</th>
                <th style={tableStyles.head}>Action</th>
                <th style={tableStyles.head}>Matched pattern</th>
                <th style={tableStyles.head}>Time</th>
                <th style={tableStyles.head}>Lead</th>
                <th style={tableStyles.head}>Call</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((emergency) => (
                <tr key={emergency.id}>
                  <td style={tableStyles.cell}>
                    <StatusPill label={emergency.severity} tone="danger" />
                  </td>
                  <td style={tableStyles.cell}>{emergency.action}</td>
                  <td style={tableStyles.cell}>{emergency.matchedPattern ?? "—"}</td>
                  <td style={{ ...tableStyles.cell, fontVariantNumeric: "tabular-nums" }}>
                    {new Date(emergency.createdAt).toLocaleString()}
                  </td>
                  <td style={tableStyles.cell}>
                    {emergency.leadId ? (
                      <Link href={`/admin/leads/${emergency.leadId}?businessId=${businessId}`}>
                        View lead
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tableStyles.cell}>
                    {emergency.callId ? (
                      <Link href={`/admin/calls?businessId=${businessId}`}>View calls</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
