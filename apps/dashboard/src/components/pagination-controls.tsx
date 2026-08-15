"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Shared page/pageSize control — pushes ?page=N onto the current URL's query params, preserving businessId and any filters already present. */
export function PaginationControls({ total, pageSize }: { total: number; pageSize: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPage = Number(searchParams.get("page") ?? "1");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(page));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        style={buttonStyle(currentPage <= 1)}
      >
        Previous
      </button>
      <span style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>
        Page {currentPage} of {totalPages} ({total} total)
      </span>
      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        style={buttonStyle(currentPage >= totalPages)}
      >
        Next
      </button>
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: disabled ? "var(--ground)" : "var(--surface)",
    color: disabled ? "var(--ink-soft)" : "var(--ink)",
    fontSize: "0.78rem",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
