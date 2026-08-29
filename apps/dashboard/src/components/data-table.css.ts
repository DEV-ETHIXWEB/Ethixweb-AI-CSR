/** Shared inline style objects for simple data tables across dashboard pages, kept as one file so Live Calls/Leads/Knowledge/etc. all render visually consistent tables rather than each re-deriving spacing/borders independently. */
export const tableStyles = {
  wrapper: {
    overflowX: "auto",
    background: "var(--surface)",
    border: "1px solid var(--border-soft)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-sm)",
  },
  table: { borderCollapse: "collapse", width: "100%", minWidth: 640 },
  head: {
    textAlign: "left",
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--ink-faint)",
    borderBottom: "1px solid var(--border-soft)",
    padding: "11px 14px",
    background: "var(--surface-sunken)",
    whiteSpace: "nowrap",
  },
  cell: {
    fontSize: "0.85rem",
    borderBottom: "1px solid var(--border-soft)",
    padding: "11px 14px",
    verticalAlign: "top",
  },
  emptyState: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--ink-soft)",
    fontSize: "0.85rem",
  },
} satisfies Record<string, React.CSSProperties>;
