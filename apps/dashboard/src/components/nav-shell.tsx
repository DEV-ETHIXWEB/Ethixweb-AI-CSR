"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { Business } from "@/lib/businesses";
import type { SessionData } from "@/lib/session";

interface NavItem {
  label: string;
  href: string;
  /** Roles allowed to see this item — omit for "every authenticated role." */
  roles?: SessionData["role"][];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/admin/overview" },
  { label: "Live Calls", href: "/admin/calls" },
  { label: "Leads", href: "/admin/leads" },
  { label: "Emergencies", href: "/admin/emergencies" },
  { label: "Capacity", href: "/admin/capacity", roles: ["owner", "admin"] },
  { label: "Knowledge", href: "/admin/knowledge", roles: ["owner", "admin"] },
  { label: "Notifications", href: "/admin/notifications" },
  { label: "Usage", href: "/admin/usage", roles: ["owner", "admin"] },
  { label: "Integrations", href: "/admin/integrations", roles: ["owner", "admin"] },
  { label: "System Health", href: "/admin/health" },
];

export function NavShell({
  session,
  businesses,
  children,
}: {
  session: SessionData;
  businesses: Business[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeBusinessId = searchParams.get("businessId") ?? businesses[0]?.id ?? "";

  const visibleItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(session.role));

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function handleBusinessChange(businessId: string) {
    const params = new URLSearchParams(searchParams);
    params.set("businessId", businessId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>Ethixweb Operations</div>

        {businesses.length > 1 ? (
          <select
            style={styles.businessSelect}
            value={activeBusinessId}
            onChange={(e) => handleBusinessChange(e.target.value)}
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : businesses[0] ? (
          <div style={styles.businessSingle}>{businesses[0].name}</div>
        ) : null}

        <nav style={styles.nav}>
          {visibleItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const href = activeBusinessId
              ? `${item.href}?businessId=${activeBusinessId}`
              : item.href;
            return (
              <Link
                key={item.href}
                href={href}
                style={{ ...styles.navLink, ...(isActive ? styles.navLinkActive : {}) }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={styles.userFooter}>
          <div style={styles.userEmail}>{session.email}</div>
          <div style={styles.userRole}>{session.role}</div>
          <button style={styles.logoutButton} onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>
      <main style={styles.content}>{children}</main>
    </div>
  );
}

const styles = {
  shell: { display: "flex", minHeight: "100vh" },
  sidebar: {
    width: 220,
    flex: "none",
    background: "var(--surface)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    padding: "20px 14px",
  },
  brand: { fontSize: "0.92rem", fontWeight: 700, marginBottom: 16, padding: "0 6px" },
  businessSelect: {
    marginBottom: 16,
    padding: "6px 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    fontSize: "0.8rem",
  },
  businessSingle: {
    marginBottom: 16,
    padding: "6px 8px",
    fontSize: "0.8rem",
    color: "var(--ink-soft)",
  },
  nav: { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  navLink: {
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: "0.85rem",
    textDecoration: "none",
    color: "var(--ink)",
  },
  navLinkActive: {
    background: "var(--accent-soft)",
    color: "var(--accent)",
    fontWeight: 600,
  },
  userFooter: {
    borderTop: "1px solid var(--border)",
    paddingTop: 12,
    marginTop: 12,
  },
  userEmail: { fontSize: "0.78rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  userRole: {
    fontSize: "0.68rem",
    color: "var(--ink-soft)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    marginBottom: 8,
  },
  logoutButton: {
    width: "100%",
    padding: "6px 10px",
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 6,
    fontSize: "0.78rem",
    cursor: "pointer",
  },
  content: { flex: 1, padding: "28px 32px", maxWidth: 1200 },
} satisfies Record<string, React.CSSProperties>;
