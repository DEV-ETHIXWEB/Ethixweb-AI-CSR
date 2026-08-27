export function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div style={styles.card}>
      <div style={styles.label}>{label}</div>
      <div style={styles.value}>{value}</div>
      {caption ? <div style={styles.caption}>{caption}</div> : null}
    </div>
  );
}

const styles = {
  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 160,
  },
  label: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--ink-soft)",
    fontWeight: 600,
  },
  value: { fontSize: "1.6rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  caption: { fontSize: "0.72rem", color: "var(--ink-soft)" },
} satisfies Record<string, React.CSSProperties>;
