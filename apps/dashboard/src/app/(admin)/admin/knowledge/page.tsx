import Link from "next/link";
import { coreApiFetch } from "@/lib/core-api-client";
import type { PaginatedKnowledge } from "@/lib/knowledge-types";
import { CreateKnowledgeForm } from "./create-form";
import { KnowledgeItemRow } from "./item-row";

type Filter = "all" | "ai" | "brochure";

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ businessId?: string; filter?: Filter; q?: string }>;
}) {
  const { businessId, filter, q } = await searchParams;

  if (!businessId) {
    return (
      <div>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Knowledge</h1>
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No business selected — this tenant has no businesses configured yet, or the selector could
          not load.
        </p>
      </div>
    );
  }

  const query = new URLSearchParams({ businessId, pageSize: "100" });
  if (filter === "ai") query.set("aiKnowledge", "true");
  if (filter === "brochure") query.set("waitingBrochure", "true");

  const result = await coreApiFetch<PaginatedKnowledge>(`/dashboard/knowledge?${query.toString()}`);

  const items = q
    ? result.items.filter(
        (item) =>
          item.title.toLowerCase().includes(q.toLowerCase()) ||
          item.content.toLowerCase().includes(q.toLowerCase()) ||
          item.category.toLowerCase().includes(q.toLowerCase()),
      )
    : result.items;

  return (
    <div>
      <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 4 }}>Knowledge</h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.82rem", marginBottom: 20 }}>
        AI Knowledge and Waiting Brochure content share the same lifecycle: every item starts as a
        draft, is only usable by the voice pipeline once approved, and editing an approved
        item&apos;s content automatically reverts it to draft (docs/38 §4) — this dashboard cannot
        bypass that, it just calls the same endpoints that enforce it.
      </p>

      <CreateKnowledgeForm businessId={businessId} />

      <form
        action="/admin/knowledge"
        method="get"
        style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}
      >
        <input type="hidden" name="businessId" value={businessId} />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search title, content, category…"
          style={{
            padding: "6px 10px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontSize: "0.82rem",
            width: 240,
          }}
        />
        <FilterLink businessId={businessId} filter={filter} target="all" label="All" />
        <FilterLink businessId={businessId} filter={filter} target="ai" label="AI Knowledge" />
        <FilterLink
          businessId={businessId}
          filter={filter}
          target="brochure"
          label="Waiting Brochure"
        />
      </form>

      {items.length === 0 ? (
        <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
          No knowledge items match this view yet.
        </p>
      ) : (
        <div>
          {items.map((item) => (
            <KnowledgeItemRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterLink({
  businessId,
  filter,
  target,
  label,
}: {
  businessId: string;
  filter: Filter | undefined;
  target: Filter;
  label: string;
}) {
  const isActive = (filter ?? "all") === target;
  const href =
    target === "all"
      ? `/admin/knowledge?businessId=${businessId}`
      : `/admin/knowledge?businessId=${businessId}&filter=${target}`;
  return (
    <Link
      href={href}
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
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Link>
  );
}
