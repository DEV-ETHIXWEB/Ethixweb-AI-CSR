/** Shared inline style objects for simple data tables across dashboard pages — kept as one file so Live Calls/Leads/Knowledge/etc. all render visually consistent tables rather than each re-deriving spacing/borders independently. */
export const tableStyles = {
  wrapper: { overflowX: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius)" },
  table: { borderCollapse: "collapse", width: "100%", minWidth: 640 },
  head: {
    textAlign: "left",
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "var(--ink-soft)",
    borderBottom: "1px solid var(--border)",
    padding: "10px 12px",
    background: "var(--ground)",
    whiteSpace: "nowrap",
  },
  cell: {
    fontSize: "0.85rem",
    borderBottom: "1px solid var(--border)",
    padding: "10px 12px",
    verticalAlign: "top",
  },
  emptyState: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--ink-soft)",
    fontSize: "0.85rem",
  },
} satisfies Record<string, React.CSSProperties>;
