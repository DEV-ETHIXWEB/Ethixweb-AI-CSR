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
    <div className="clay-surface" style={styles.card}>
      <div style={styles.label}>{label}</div>
      <div style={styles.value}>{value}</div>
      {caption ? <div style={styles.caption}>{caption}</div> : null}
    </div>
  );
}

const styles = {
  card: {
    padding: "18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 160,
  },
  label: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--ink-faint)",
    fontWeight: 700,
  },
  value: {
    fontSize: "1.75rem",
    fontWeight: 800,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    color: "var(--ink)",
  },
  caption: { fontSize: "0.72rem", color: "var(--ink-soft)" },
} satisfies Record<string, React.CSSProperties>;
