const TONE_CLASS = {
  ok: "ok",
  warn: "warn",
  danger: "danger",
  unknown: "unknown",
} as const;

/** Generic status pill for any {label, tone} pair — used by call/lead status badges. Tone is a caller decision, not inferred here, so callers stay honest about what a status actually means rather than this component guessing. */
export function StatusPill({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return <span className={`stat-pill ${TONE_CLASS[tone]}`}>{label}</span>;
}
