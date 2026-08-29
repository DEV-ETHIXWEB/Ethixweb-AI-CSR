"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
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
      <form className="clay-surface" style={styles.card} onSubmit={handleSubmit}>
        <Image
          src="/ethixweb-wordmark.png"
          alt="Ethixweb"
          width={188}
          height={28}
          priority
          style={styles.brandWordmark}
        />
        <h1 style={styles.title}>Operations</h1>
        <p style={styles.subtitle}>Sign in with your tenant, email, and password.</p>

        {error ? <div style={styles.error}>{error}</div> : null}

        <label style={styles.label} htmlFor="tenantId">
          Tenant ID
        </label>
        <input
          id="tenantId"
          className="clay-input"
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
          className="clay-input"
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
          className="clay-input"
          style={styles.input}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button
          type="submit"
          className="clay-btn clay-btn-primary"
          style={styles.button}
          disabled={submitting}
        >
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
    background:
      "radial-gradient(ellipse 60% 46% at 82% 0%, oklch(50% .22 29 / .08), transparent 62%), radial-gradient(ellipse 46% 36% at 8% 15%, oklch(50% .22 29 / .05), transparent 60%), var(--ground)",
  },
  card: {
    width: 380,
    padding: "36px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  brandWordmark: { display: "block", width: "auto", marginBottom: 18 },
  title: { fontSize: "1.2rem", fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.01em" },
  subtitle: { fontSize: "0.82rem", color: "var(--ink-soft)", margin: "0 0 16px" },
  label: { fontSize: "0.72rem", fontWeight: 600, marginTop: 12, marginBottom: 6 },
  input: {
    padding: "9px 12px",
    fontSize: "0.88rem",
  },
  button: {
    marginTop: 22,
    padding: "11px 14px",
    fontSize: "0.9rem",
  },
  error: {
    background: "var(--danger-soft)",
    color: "var(--danger)",
    padding: "9px 12px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.82rem",
    marginBottom: 8,
  },
} satisfies Record<string, React.CSSProperties>;
