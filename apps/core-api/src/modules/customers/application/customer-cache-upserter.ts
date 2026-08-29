import { Inject, Injectable } from "@nestjs/common";
import { CustomerPhoneAlreadyExistsError } from "../domain/errors";
import type { Customer } from "../domain/customer.entity";
import {
  CUSTOMER_REPOSITORY,
  type CreateCustomerInput,
  type CustomerRepository,
  type Db,
} from "../domain/ports/customer-repository.port";

export interface UpsertResult {
  customer: Customer;
  /** False when the row already existed (this attempt lost the create race, or a prior call already cached it) — callers use this to decide whether a "customer.created" domain event is warranted. */
  created: boolean;
}

/**
 * The single place docs/13-implementation-backlog.md `customers` module
 * §4's race-handling requirement is implemented — shared by both
 * ResolveCustomerUseCase's cache-write-back path and CreateCustomerUseCase,
 * rather than duplicated in each. Two concurrent callers racing to cache
 * the SAME (businessId, phoneE164) both succeed here (one creates, the
 * other re-fetches and returns the same row) — a deliberately different
 * outcome from, say, the auth module's registration race, where the loser
 * gets a 409. Here there's no "loser": both callers already agree on what
 * the CRM said the customer's phone number is, so returning the row either
 * one of them tried to create is correct for both.
 */
@Injectable()
export class CustomerCacheUpserter {
  constructor(
    @Inject(CUSTOMER_REPOSITORY) private readonly customerRepository: CustomerRepository,
  ) {}

  async upsert(db: Db, input: CreateCustomerInput): Promise<UpsertResult> {
    // A SAVEPOINT taken immediately before the insert attempt — Postgres
    // aborts the ENTIRE enclosing transaction after any error (including a
    // unique-constraint violation), so without this, the recovery
    // findByPhone call below fails with `25P02: current transaction is
    // aborted, commands ignored until end of transaction block` even though
    // this looks like it's handling the race. Same real bug, found the same
    // way, as CreateLeadUseCase.upsertByCallId's identical comment — see
    // that one for the full explanation of why no mocked-repository unit
    // test can catch this.
    await db.$executeRaw`SAVEPOINT create_customer_attempt`;
    try {
      const customer = await this.customerRepository.create(db, input);
      return { customer, created: true };
    } catch (error) {
      if (!(error instanceof CustomerPhoneAlreadyExistsError)) {
        throw error;
      }
      await db.$executeRaw`ROLLBACK TO SAVEPOINT create_customer_attempt`;
      const existing = await this.customerRepository.findByPhone(
        db,
        input.tenantId,
        input.businessId,
        input.phoneE164,
      );
      if (!existing) {
        // Unreachable in practice (the constraint violation itself proves a
        // row exists) — satisfies the non-null return without a non-null
        // assertion, the same defensive pattern used elsewhere in this
        // codebase (e.g. PrismaApiKeyRepository.revoke).
        throw new Error(
          `CustomerCacheUpserter: constraint violation for ${input.phoneE164} but no row found on re-fetch`,
        );
      }
      return { customer: existing, created: false };
    }
  }
}
