"use client";

import { useEffect } from "react";

/**
 * Real error boundary for the entire /admin route group — without this,
 * an unreachable core-api (or any thrown CoreApiError/UnauthenticatedError
 * from a Server Component like Overview) falls through to Next.js's
 * default, unstyled error screen. Confirmed missing by directly testing
 * this app against a stopped core-api during this phase's own
 * verification, not assumed to already exist.
 *
 * Matches error NAMES as plain strings rather than importing the actual
 * CoreApiError/UnauthenticatedError classes from lib/core-api-client.ts —
 * that module transitively imports lib/session.ts, which uses
 * next/headers, a server-only API. This file is a Client Component (Next
 * error boundaries always are), so pulling in that import chain breaks
 * the build even though nothing here actually calls the server-only code
 * — confirmed by hitting this exact webpack error while first wiring this
 * boundary up.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin dashboard error:", error);
  }, [error]);

  const isAuthError = error.name === "UnauthenticatedError";
  const isCoreApiError = error.name === "CoreApiError";

  return (
    <div style={{ padding: "48px 32px", maxWidth: 480 }}>
      <h1 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 8 }}>
        {isAuthError ? "Your session has expired" : "Something went wrong loading this page"}
      </h1>
      <p style={{ color: "var(--ink-soft)", fontSize: "0.85rem", marginBottom: 16 }}>
        {isAuthError
          ? "Please sign in again."
          : isCoreApiError
            ? "The server could not complete this request. This may be temporary."
            : "An unexpected error occurred."}
      </p>
      {isAuthError ? (
        <a href="/login" style={{ color: "var(--accent)", fontWeight: 600, fontSize: "0.85rem" }}>
          Go to sign in
        </a>
      ) : (
        <button
          onClick={reset}
          style={{
            padding: "8px 14px",
            background: "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: "0.85rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
