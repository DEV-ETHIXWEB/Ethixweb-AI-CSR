/**
 * Go-live readiness check, not a unit test: `GetBusinessHoursUseCase`'s
 * "zero rows configured -> report closed" fail-safe is correct BY DESIGN
 * and already has dedicated unit coverage (get-business-hours.use-case.spec.ts,
 * "returns the conservative after-hours default when nothing is
 * configured") — that code path was never the bug.
 *
 * The real bug found live: All Phase Plumbing (a genuinely 24/7 business,
 * per its own published site) had ZERO BusinessHour rows configured and a
 * placeholder `America/Chicago` timezone (leftover fixture data, wrong
 * for a Seattle-area business) — so the real `getBusinessHours` tool
 * silently told every real caller the office was closed, while the
 * knowledge base (docs/knowledge/all-phase-plumbing/) correctly said
 * "24/7." Nothing in the codebase would have caught a business going live
 * in this state; a unit test on the use case can't catch a DATA gap on a
 * specific tenant. This script is that missing check — run it before
 * declaring any tenant ready for real calls, and periodically afterward.
 *
 * Run: pnpm exec ts-node scripts/check-tenant-readiness.ts (from apps/core-api)
 * Exits non-zero if any active business fails a check, so it's CI/cron-able.
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/shared/prisma/prisma.service";
import { TenantContextService } from "../src/shared/prisma/tenant-context.service";

interface Finding {
  businessId: string;
  businessName: string;
  issue: string;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const prisma = app.get(PrismaService);
    const tenantContext = app.get(TenantContextService);

    // `tenants` has no RLS policy (it's the tenant root — nothing to scope
    // it BY), so this list is safe unscoped. `businesses`/`business_hours`
    // both DO have a `tenant_id = current_setting('app.tenant_id')` RLS
    // policy — querying them without going through `tenantContext.run()`
    // for each tenant doesn't error, it silently returns zero rows (found
    // live running this exact script: it happily reported "OK, 0
    // businesses checked" while the one real business in this database sat
    // completely unconfigured). Looping per-tenant is what makes this
    // script actually see anything.
    const tenants = await prisma.tenant.findMany({ select: { id: true } });

    const findings: Finding[] = [];
    let totalChecked = 0;
    for (const tenant of tenants) {
      await tenantContext.run(tenant.id, async (db) => {
        const businesses = await db.business.findMany({
          where: { status: "active" },
          select: { id: true, name: true, timezone: true },
        });
        for (const business of businesses) {
          totalChecked += 1;
          const hourCount = await db.businessHour.count({ where: { businessId: business.id } });
          if (hourCount === 0) {
            findings.push({
              businessId: business.id,
              businessName: business.name,
              issue:
                "zero BusinessHour rows configured — getBusinessHours will always report closed (fail-safe default), regardless of what any knowledge-base or prompt content claims about hours",
            });
          }
          // Real IANA zone name sanity check, not a real-timezone verifier
          // — catches the exact failure mode found live (a copy-pasted
          // fixture timezone from an unrelated test scenario left on a
          // real tenant). Intentionally does NOT try to verify the zone is
          // geographically correct for the business's address — that
          // needs a human, not a heuristic.
          try {
            Intl.DateTimeFormat("en-US", { timeZone: business.timezone });
          } catch {
            findings.push({
              businessId: business.id,
              businessName: business.name,
              issue: `timezone "${business.timezone}" is not a valid IANA zone name`,
            });
          }
        }
      });
    }

    if (findings.length === 0) {
      console.log(`OK — ${totalChecked} active business(es) checked, no readiness issues found.`);
      return;
    }

    console.error(`FOUND ${findings.length} readiness issue(s):`);
    for (const f of findings) {
      console.error(`  [${f.businessName} / ${f.businessId}] ${f.issue}`);
    }
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
