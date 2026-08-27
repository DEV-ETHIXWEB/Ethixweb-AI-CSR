"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Sign-in failed. Check your details and try again.");
        return;
      }
      const next = searchParams.get("next") ?? "/admin/overview";
      router.push(next);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>Ethixweb Operations</h1>
        <p style={styles.subtitle}>Sign in with your tenant, email, and password.</p>

        {error ? <div style={styles.error}>{error}</div> : null}

        <label style={styles.label} htmlFor="tenantId">
          Tenant ID
        </label>
        <input
          id="tenantId"
          style={styles.input}
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
          required
        />

        <label style={styles.label} htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <label style={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" style={styles.button} disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--ground)",
  },
  card: {
    width: 360,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "32px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  title: { fontSize: "1.15rem", fontWeight: 700, margin: "0 0 4px" },
  subtitle: { fontSize: "0.82rem", color: "var(--ink-soft)", margin: "0 0 16px" },
  label: { fontSize: "0.72rem", fontWeight: 600, marginTop: 12, marginBottom: 4 },
  input: {
    padding: "8px 10px",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: "0.88rem",
    fontFamily: "var(--font-sans)",
  },
  button: {
    marginTop: 20,
    padding: "10px 14px",
    background: "var(--accent)",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: "0.9rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: "0.82rem",
    marginBottom: 8,
  },
} satisfies Record<string, React.CSSProperties>;
