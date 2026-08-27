import type { Db } from "../domain/ports/customer-repository.port";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { CustomerCacheUpserter } from "./customer-cache-upserter";

// Not `undefined` — upsert() issues a SAVEPOINT/ROLLBACK TO SAVEPOINT
// around the create-then-recover race (see its own comment for why a real
// Postgres SAVEPOINT is required there). A fake has no real transaction to
// poison, so a no-op $executeRaw is the correct stand-in, not a workaround.
const fakeDb = { $executeRaw: async () => 0 } as unknown as Db;

describe("CustomerCacheUpserter", () => {
  it("creates a new row when none exists yet", async () => {
    const repository = new FakeCustomerRepository();
    const upserter = new CustomerCacheUpserter(repository);

    const { customer, created } = await upserter.upsert(fakeDb, {
      tenantId: "tenant-1",
      businessId: "business-1",
      phoneE164: "+15551234567",
      name: "Jane Doe",
    });

    expect(created).toBe(true);
    expect(customer.name).toBe("Jane Doe");
  });

  it(
    "CONCURRENCY: two simultaneous upserts for the SAME phone number both succeed — " +
      "one creates, the other returns the same existing row (docs/13 customers module §4)",
    async () => {
      const repository = new FakeCustomerRepository();
      const upserter = new CustomerCacheUpserter(repository);
      const input = {
        tenantId: "tenant-1",
        businessId: "business-1",
        phoneE164: "+15551234567",
        name: "Jane Doe",
      };

      const [first, second] = await Promise.all([
        upserter.upsert(fakeDb, input),
        upserter.upsert(fakeDb, input),
      ]);

      // Exactly one of the two actually created the row...
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
      // ...but BOTH callers get the SAME customer id back — neither one is
      // treated as an error, unlike a typical "loser gets 409" race.
      expect(first.customer.id).toBe(second.customer.id);
    },
  );

  it(
    "REGRESSION: issues SAVEPOINT before the insert attempt and ROLLBACK TO SAVEPOINT before " +
      "the recovery read on a phone-number race — without this, the recovery findByPhone runs " +
      "inside a Postgres transaction Postgres itself already aborted after the constraint " +
      "violation (25P02), which a mocked repository can never simulate but genuine concurrent " +
      "load against real Postgres hit immediately (found and fixed as a real production-blocking " +
      "bug, not a theoretical one — see create-lead.use-case.spec.ts's identical regression test)",
    async () => {
      const executedRawStatements: string[] = [];
      const spyDb = {
        $executeRaw: (strings: TemplateStringsArray) => {
          executedRawStatements.push(strings.join(""));
          return Promise.resolve(0);
        },
      } as unknown as Db;
      const repository = new FakeCustomerRepository();
      const upserter = new CustomerCacheUpserter(repository);
      const input = {
        tenantId: "tenant-1",
        businessId: "business-1",
        phoneE164: "+15551234567",
        name: "Jane Doe",
      };

      await Promise.all([upserter.upsert(spyDb, input), upserter.upsert(spyDb, input)]);

      expect(executedRawStatements).toContain("SAVEPOINT create_customer_attempt");
      expect(executedRawStatements).toContain("ROLLBACK TO SAVEPOINT create_customer_attempt");
      const savepointIndex = executedRawStatements.indexOf("SAVEPOINT create_customer_attempt");
      const rollbackIndex = executedRawStatements.indexOf(
        "ROLLBACK TO SAVEPOINT create_customer_attempt",
      );
      expect(savepointIndex).toBeLessThan(rollbackIndex);
    },
  );
});
