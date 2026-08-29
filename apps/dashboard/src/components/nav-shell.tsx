"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import type { Business } from "@/lib/businesses";
import type { SessionData } from "@/lib/session";

interface NavItem {
  label: string;
  href: string;
  /** Roles allowed to see this item, omit for "every authenticated role." */
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
        <div style={styles.brandRow}>
          <Image
            src="/ethixweb-wordmark.png"
            alt="Ethixweb"
            width={148}
            height={22}
            priority
            style={styles.brandWordmark}
          />
          <span style={styles.brandSubtitle}>Operations</span>
        </div>

        {businesses.length > 1 ? (
          <select
            className="clay-input"
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
          <button
            className="clay-btn clay-btn-secondary"
            style={styles.logoutButton}
            onClick={handleLogout}
          >
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
    width: 232,
    flex: "none",
    background: "var(--surface)",
    borderRight: "1px solid var(--border-soft)",
    boxShadow: "1px 0 0 oklch(100% 0 0 / .6), 4px 0 24px -12px oklch(16% .02 275 / .12)",
    display: "flex",
    flexDirection: "column",
    padding: "22px 16px",
  },
  brandRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBottom: 20,
    padding: "0 4px",
  },
  brandWordmark: { display: "block", width: "auto" },
  brandSubtitle: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--ink-faint)",
    letterSpacing: "0.01em",
  },
  businessSelect: {
    width: "100%",
    marginBottom: 18,
    padding: "8px 10px",
    fontSize: "0.8rem",
  },
  businessSingle: {
    marginBottom: 18,
    padding: "8px 10px",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--ink-soft)",
    background: "var(--surface-sunken)",
    borderRadius: "var(--radius-sm)",
  },
  nav: { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  navLink: {
    padding: "9px 12px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.85rem",
    fontWeight: 500,
    textDecoration: "none",
    color: "var(--ink-soft)",
    transition: "background 0.12s ease, color 0.12s ease",
  },
  navLinkActive: {
    background: "var(--primary-soft)",
    color: "var(--primary)",
    fontWeight: 700,
    boxShadow: "inset 0 1px oklch(100% 0 0 / .6)",
  },
  userFooter: {
    borderTop: "1px solid var(--border-soft)",
    paddingTop: 14,
    marginTop: 14,
  },
  userEmail: { fontSize: "0.78rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" },
  userRole: {
    fontSize: "0.66rem",
    color: "var(--ink-faint)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: 10,
  },
  logoutButton: {
    width: "100%",
    padding: "8px 10px",
    fontSize: "0.78rem",
  },
  content: { flex: 1, padding: "28px 32px", maxWidth: 1240 },
} satisfies Record<string, React.CSSProperties>;
