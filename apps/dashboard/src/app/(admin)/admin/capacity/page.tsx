import { StatCard } from "@/components/stat-card";
import { coreApiFetch } from "@/lib/core-api-client";
import type { CapacityConfig } from "@/lib/capacity-config-types";
import { CapacityForm } from "./capacity-form";

export default async function CapacityPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Capacity</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const config = await coreApiFetch<CapacityConfig>(`/dashboard/capacity-config/${businessId}`);
  const isDefault = config.id === null;

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Capacity</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 20 }}>
        {isDefault
          ? "This business has no capacity policy configured yet — showing platform defaults. Saving below creates the first real, business-specific row."
          : "Business-specific capacity policy — overrides the platform defaults."}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 28,
        }}
      >
        <StatCard label="Max concurrent" value={String(config.maxTenantConcurrentCalls)} />
        <StatCard
          label="Emergency headroom"
          value={`${Math.round(config.emergencyHeadroomRatio * 100)}%`}
        />
        <StatCard label="Brochure" value={config.brochureEnabled ? "Enabled" : "Disabled"} />
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginBottom: 8 }}>
        &quot;Current capacity&quot; (how many calls are active right now against this ceiling) is
        shown on the Overview page — this page is configuration only, not a live gauge.
      </p>

      <CapacityForm businessId={businessId} config={config} />

      <p style={{ fontSize: "0.72rem", color: "var(--ink-soft)", marginTop: 20 }}>
        Every save here writes a real <code>AuditLog</code> entry (
        <code>capacity_config.updated</code>, with the full before/after row) — the same audit
        mechanism Knowledge uses. There is no read endpoint yet to browse that history from this
        dashboard, so the audit trail exists in the database but isn&apos;t visible here today.
      </p>
    </div>
  );
}
