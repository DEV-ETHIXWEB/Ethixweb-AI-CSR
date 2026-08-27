import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { coreApiFetch, CoreApiError } from "@/lib/core-api-client";
import type { CustomerSummary, LeadPriority, LeadStatus, LeadSummary } from "@/lib/leads-types";
import type { CallSummary } from "@/lib/calls-types";

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  notified: "Notified",
  claimed: "Claimed",
  converted_to_job: "Converted",
  expired: "Expired",
  duplicate: "Duplicate",
  abandoned: "Abandoned",
};

const PRIORITY_TONE: Record<LeadPriority, "ok" | "warn" | "danger" | "unknown"> = {
  emergency: "danger",
  urgent: "warn",
  routine: "unknown",
  estimate: "unknown",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await coreApiFetch<LeadSummary>(`/leads/${id}`);

  // Customer/call enrichment is genuinely best-effort here: LeadResponseDto
  // only carries customerId/callId (no embedded name/phone — confirmed by
  // reading the actual DTO, not assumed), so this page makes two
  // additional, single-record fetches rather than fetching a full page of
  // OTHER customers/calls just to enrich one row. A failure on either
  // (e.g. a customer/call somehow missing) degrades that one section
  // rather than failing the whole page — the lead itself is still shown.
  const [customer, call] = await Promise.all([
    coreApiFetch<CustomerSummary>(`/customers/${lead.customerId}`).catch((error: unknown) =>
      error instanceof CoreApiError ? null : Promise.reject(error),
    ),
    coreApiFetch<CallSummary>(`/calls/${lead.callId}`).catch((error: unknown) =>
      error instanceof CoreApiError ? null : Promise.reject(error),
    ),
  ]);

  return (
    <div style={{ maxWidth: 640 }}>
      <Link
        href={`/admin/leads?businessId=${lead.businessId}`}
        style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}
      >
        ← Back to Leads
      </Link>

      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "8px 0 4px" }}>
        {lead.problemSummary}
      </h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <StatusPill
          label={lead.priority}
          tone={PRIORITY_TONE[lead.priority as LeadPriority] ?? "unknown"}
        />
        <StatusPill label={STATUS_LABEL[lead.status]} tone="unknown" />
      </div>

      <Section title="Customer">
        {customer ? (
          <>
            <Field label="Name" value={customer.name} />
            <Field label="Phone" value={customer.phoneE164} />
          </>
        ) : (
          <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>
            Customer record unavailable.
          </p>
        )}
      </Section>

      <Section title="Call">
        {call ? (
          <>
            <Field label="From" value={call.fromNumber} />
            <Field label="Started" value={new Date(call.startedAt).toLocaleString()} />
            <Field label="Status" value={call.status} />
          </>
        ) : (
          <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem" }}>Call record unavailable.</p>
        )}
      </Section>

      <Section title="Lead details">
        <Field label="Type" value={lead.leadType} />
        <Field label="Created" value={new Date(lead.createdAt).toLocaleString()} />
        <Field label="Updated" value={new Date(lead.updatedAt).toLocaleString()} />
        <Field label="Lead ID" value={lead.id} mono />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 8 }}>{title}</h2>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", gap: 12 }}>
      <span style={{ color: "var(--ink-soft)" }}>{label}</span>
      <span style={mono ? { fontFamily: "var(--font-mono)", fontSize: "0.75rem" } : undefined}>
        {value}
      </span>
    </div>
  );
}
