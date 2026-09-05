/**
 * One-off seed script: populates real `KnowledgeItem` rows for the
 * All Phase Plumbing business from the facts documented (with source
 * provenance) in `docs/knowledge/all-phase-plumbing/`. Uses the REAL
 * `CreateKnowledgeItemUseCase` / `ApproveKnowledgeItemUseCase` against a
 * real Nest application context (`NestFactory.createApplicationContext`)
 * so this goes through the exact same domain logic, lifecycle validation,
 * and Prisma writes a dashboard operator's HTTP request would — no
 * parallel/duplicate knowledge system, no raw SQL. Idempotent: skips any
 * (businessId, category, title) that already exists so re-running this
 * after editing an item below only adds what's missing.
 *
 * Run: pnpm exec ts-node scripts/seed-all-phase-knowledge.ts
 * (from apps/core-api)
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module";
import { CreateKnowledgeItemUseCase } from "../src/modules/knowledge/application/create-knowledge-item.use-case";
import { ApproveKnowledgeItemUseCase } from "../src/modules/knowledge/application/approve-knowledge-item.use-case";
import { ListKnowledgeItemsUseCase } from "../src/modules/knowledge/application/list-knowledge-items.use-case";

const TENANT_ID = "ee0c3e21-8be3-4698-91d6-7f177460d5c1";
const BUSINESS_ID = "7f7a0a53-377c-464a-9022-38e3714f205b";
/** The seeded dashboard owner (owner@allphaseplumbing.local) — real actor id for audit fields, not a synthetic "system" user. */
const ACTOR_USER_ID = "60b2ed7f-9c6f-4e5e-bb18-5132b301e00b";

interface SeedItem {
  category: string;
  title: string;
  content: string;
  priority: number;
}

// Priority: lower number = higher priority (KnowledgeItem.priority doc
// comment). Gas safety and emergency facts lead; promotions trail — a
// caller very rarely opens with "what are your coupons."
const ITEMS: SeedItem[] = [
  {
    category: "emergency",
    title: "Gas leak safety",
    content:
      "If a caller smells gas: they should leave the building immediately, not operate any electrical switches, and call the gas utility's emergency line from outside. Only after the gas utility has made the area safe should All Phase Plumbing be contacted. Warning signs of a gas leak: rotten-egg smell near appliances/lines, hissing from gas lines, dead vegetation over a buried line, an unexplained jump in the gas bill, or headaches/dizziness/nausea indoors.",
    priority: 0,
  },
  {
    category: "emergency",
    title: "What counts as a plumbing emergency",
    content:
      "Burst or leaking pipes flooding the home, no water anywhere in the house, sewer backup into sinks/tubs/floor drains, a leaking or flooding water heater, the only toilet in the home not working, and frozen pipes that may burst when thawed.",
    priority: 1,
  },
  {
    category: "emergency",
    title: "Emergency safety steps before a technician arrives",
    content:
      "Shut off the main water valve to stop active flooding, turn off the water heater if it's leaking, move valuables away from the affected area, and take photos for insurance documentation. Most Seattle-area emergency calls are reached within 60-90 minutes; severe weather may extend that. This is a general expectation, not a guaranteed arrival time for a specific call.",
    priority: 2,
  },
  {
    category: "company",
    title: "Company identity and credentials",
    content:
      "All Phase Plumbing is a family-owned plumbing company based in Tukwila, WA, serving the Greater Seattle area since 1989. Licensed and insured (License #ALLPHPS793PE). Technicians are licensed, bonded, background-checked direct employees, not subcontractors.",
    priority: 3,
  },
  {
    category: "company",
    title: "Hours and same-day service",
    content:
      "Open 24/7 with a real live dispatcher on the emergency line, not just an answering service. Same-day service is offered when booked before 2pm, Monday through Friday.",
    priority: 4,
  },
  {
    category: "company",
    title: "Pricing philosophy",
    content:
      "Upfront, honest pricing: flat-rate quotes given before any work begins, no hidden fees once a quote is given. No specific dollar amounts are published for any service, and the site does not state whether there's a charge just to have a technician come diagnose/quote a job — never invent a price, and never claim there is or isn't a diagnostic/trip fee since that isn't published either way; if asked directly, say that's confirmed when the visit is booked rather than guessing.",
    priority: 5,
  },
  {
    category: "company",
    title: "Warranty",
    content:
      "Every repair and installation is backed by a written guarantee. Specific warranty length/terms aren't published, so don't invent a duration.",
    priority: 6,
  },
  {
    category: "company",
    title: "Contact information",
    content: "Phone (206) 309-1088. Address 14101 Interurban Ave S, Unit 78-A, Tukwila, WA 98168.",
    priority: 7,
  },
  {
    category: "service_area",
    title: "Cities and counties served",
    content:
      "Serves King and Pierce counties: Seattle, Tacoma, Auburn, Bellevue, Kirkland, Redmond, Renton, Kent, Mercer Island, Federal Way, Des Moines, Bonney Lake, Puyallup, South Hill, Spanaway, Summit, Summit View, Fife, Lakewood, Bothell, and Tukwila (headquarters). For a city not on this list, the company's own position is 'we likely serve your area, call to confirm' — use that hedge rather than a flat yes or no.",
    priority: 8,
  },
  {
    category: "services",
    title: "Water heaters",
    content:
      "Handles no hot water, rusty water, leaking tanks, and popping/rumbling noises (sediment). Offers tank and tankless installation/replacement, repair, annual flush, anode rod and thermostat/heating element replacement, gas and electric units. Tank heaters last 8-12 years; tankless units are rated 20+ years with 25-35% energy savings but cost more upfront. 24/7 emergency water heater service available.",
    priority: 10,
  },
  {
    category: "services",
    title: "Drain cleaning and hydro jetting",
    content:
      "Handles slow drains, gurgling, foul odors, and recurring clogs. Standard cleaning uses augers/snakes; hydro jetting uses up to 4,000 PSI water pressure for severe grease, scale, or tree roots when a plunger/snake can't clear it, residential or commercial. Camera inspection available to find leaks/cracks/root intrusion without digging.",
    priority: 11,
  },
  {
    category: "services",
    title: "Sewer repair and replacement",
    content:
      "Warning signs: slow drains, frequent clogs, foul sewer odor, gurgling toilets, water pooling in the yard. Repair fixes localized damage (excavation or trenchless); replacement installs new piping for severely collapsed/corroded lines — decided after a camera inspection. Trenchless repair uses small access points to install a liner/replacement internally, typically 1-2 days; traditional excavation can take several days to a week.",
    priority: 12,
  },
  {
    category: "services",
    title: "Toilets",
    content:
      "Handles running toilets, weak/incomplete flushing, leaking seals/base leaks, faulty flapper/refill valves, cracked tank or bowl. Replacement is recommended after 2+ repairs in a year, structural damage, or an old high-water-use model. Also does new installs including smart toilets and bidet-integrated units.",
    priority: 13,
  },
  {
    category: "services",
    title: "Sump pumps",
    content:
      "Addresses basement flooding risk during heavy rain. Repair covers pumps that run constantly, fail to pump, have a stuck float, a frozen discharge line, or electrical issues. Replacement recommended for systems 7-10+ years old, including battery-backup options. Also does new installs.",
    priority: 14,
  },
  {
    category: "services",
    title: "Repiping",
    content:
      "Warning signs: rust-colored or metallic-tasting water, leaks in multiple spots within a year, reduced pressure when multiple fixtures run at once, visible corrosion, homes 50+ years old with original galvanized steel. Primarily uses PEX (flexible, freeze-tolerant, 50+ year rating), or Type L copper when code/preference requires it. Most single-family homes take 2-5 days, done in phases to restore water service each evening where possible.",
    priority: 15,
  },
  {
    category: "services",
    title: "Garbage disposals",
    content:
      "Handles worn parts, electrical faults, clogs, jams, leaks, grinding noises, odors. Repair suits a relatively new unit with an isolated problem; replacement suits a unit past ~10 years old (most quality units last 8-15 years with normal care).",
    priority: 16,
  },
  {
    category: "services",
    title: "Water softeners",
    content:
      "Hard water causes mineral buildup that shortens fixture/appliance life. Signs of a failing softener: soap scum, cloudy dishes, stiff laundry, low pressure from mineral buildup, salty/metallic-tasting water, or unusually high salt use. Services: installation, repair (salt bridges, resin, valves), and maintenance (salt refill, brine tank cleaning) — annual maintenance recommended.",
    priority: 17,
  },
  {
    category: "services",
    title: "Gas line services (non-emergency)",
    content:
      "Beyond emergency leak response, the company does gas line detection/repair, new-line installation (appliances, grills, generators, fire pits), shutoff valve replacement, pressure testing with certification, and permit coordination for code compliance.",
    priority: 18,
  },
  {
    category: "services",
    title: "Commercial services",
    content:
      "Serves offices, retail, restaurants, industrial facilities, apartments/multi-family, and mixed-use properties. Offers water heater service, drain cleaning/hydro jetting, sewer repair/replacement, commercial fixture install/repair, leak detection, repiping, grease trap maintenance (restaurants), and preventive maintenance programs. 24/7 emergency commercial service. Same upfront flat-rate pricing philosophy as residential; no commercial-specific pricing published.",
    priority: 19,
  },
  {
    category: "promotions",
    title: "Current coupons (expire 10/31/2026)",
    content:
      "Three current offers, all residential-homeowners-only, one per household, must be shown at time of service, not valid with other offers, expiring 10/31/2026: $100 off drain cleaning (includes a free mainline sewer camera inspection); 10% off the next residential plumbing service call (capped at $250); $250 off any residential water heater install/replacement. Only mention these if genuinely relevant to what the caller is asking about — don't lead with them.",
    priority: 30,
  },
];

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  try {
    const createUseCase = app.get(CreateKnowledgeItemUseCase);
    const approveUseCase = app.get(ApproveKnowledgeItemUseCase);
    const listUseCase = app.get(ListKnowledgeItemsUseCase);

    const existing = await listUseCase.execute({
      tenantId: TENANT_ID,
      businessId: BUSINESS_ID,
      page: 1,
      pageSize: 500,
    });
    const existingKey = new Set(existing.items.map((i) => `${i.category}::${i.title}`));

    let created = 0;
    let skipped = 0;
    for (const item of ITEMS) {
      const key = `${item.category}::${item.title}`;
      if (existingKey.has(key)) {
        skipped += 1;
        console.log(`skip (already exists): ${key}`);
        continue;
      }
      const draft = await createUseCase.execute({
        tenantId: TENANT_ID,
        businessId: BUSINESS_ID,
        category: item.category,
        title: item.title,
        content: item.content,
        aiKnowledge: true,
        waitingBrochure: false,
        priority: item.priority,
        createdByUserId: ACTOR_USER_ID,
      });
      await approveUseCase.execute({
        tenantId: TENANT_ID,
        itemId: draft.id,
        actorUserId: ACTOR_USER_ID,
      });
      created += 1;
      console.log(`created + approved: ${key} (${draft.id})`);
    }

    console.log(`\nDone. Created ${created}, skipped ${skipped} (already present).`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
