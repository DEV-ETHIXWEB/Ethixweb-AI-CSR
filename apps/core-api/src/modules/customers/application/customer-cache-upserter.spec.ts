import type { Db } from "../domain/ports/customer-repository.port";
import { FakeCustomerRepository } from "./__fakes__/fake-customer-repository";
import { CustomerCacheUpserter } from "./customer-cache-upserter";

describe("CustomerCacheUpserter", () => {
  it("creates a new row when none exists yet", async () => {
    const repository = new FakeCustomerRepository();
    const upserter = new CustomerCacheUpserter(repository);

    const { customer, created } = await upserter.upsert(undefined as unknown as Db, {
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
        upserter.upsert(undefined as unknown as Db, input),
        upserter.upsert(undefined as unknown as Db, input),
      ]);

      // Exactly one of the two actually created the row...
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
      // ...but BOTH callers get the SAME customer id back — neither one is
      // treated as an error, unlike a typical "loser gets 409" race.
      expect(first.customer.id).toBe(second.customer.id);
    },
  );
});
