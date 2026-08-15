import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { NavShell } from "@/components/nav-shell";
import { listBusinesses } from "@/lib/businesses";
import { getSession } from "@/lib/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    // Belt-and-suspenders: middleware already redirects unauthenticated
    // requests before they reach this layout, but a Server Component
    // should never assume a cookie it didn't itself validate is still
    // good — this is the real authorization check, not the edge one.
    redirect("/login");
  }

  const businesses = await listBusinesses().catch(() => []);

  return (
    <NavShell session={session} businesses={businesses}>
      {children}
    </NavShell>
  );
}
