import { coreApiFetch } from "@/lib/core-api-client";
import type { Integration } from "@/lib/integrations-types";
import { ConnectIntegrationForm } from "./connect-form";
import { IntegrationRow } from "./integration-row";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string }>;
}) {
  const { businessId } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Integrations</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const integrations = await coreApiFetch<Integration[]>(`/integrations?businessId=${businessId}`);

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Integrations</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 20 }}>
        CRM integrations for this business. Status always reflects the real backend value — a newly
        connected integration starts as <code>pending_verification</code>, not
        &quot;connected&quot;, until Verify actually succeeds against the CRM.
      </p>

      <ConnectIntegrationForm businessId={businessId} />

      {integrations.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No CRM integrations connected for this business yet.
        </p>
      ) : (
        <div>
          {integrations.map((integration) => (
            <IntegrationRow key={integration.id} integration={integration} />
          ))}
        </div>
      )}
    </div>
  );
}
