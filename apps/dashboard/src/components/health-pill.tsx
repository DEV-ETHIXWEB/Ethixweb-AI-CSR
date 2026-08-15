import type { ComponentHealth } from "@/lib/dashboard-types";

const LABELS: Record<ComponentHealth, string> = {
  healthy: "Healthy",
  down: "Down",
  unknown: "Unknown",
};

const CLASS: Record<ComponentHealth, string> = {
  healthy: "ok",
  down: "danger",
  unknown: "unknown",
};

/** Never renders green for "unknown" — matches core-api's own GetDashboardHealthUseCase honesty rule (docs/37 §6): a component this deployment genuinely cannot observe is shown as Unknown, not faked healthy. */
export function HealthPill({ status }: { status: ComponentHealth }) {
  return <span className={`stat-pill ${CLASS[status]}`}>{LABELS[status]}</span>;
}
