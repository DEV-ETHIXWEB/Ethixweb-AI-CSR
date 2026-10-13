/**
 * `db` is handed to the work callback as a minimal Prisma-shaped stub
 * rather than `undefined`: GetCapacityConfigUseCase now reads the business
 * name off the same client inside the same tenant context, so a fake that
 * supplies nothing would test a code path production never takes.
 */
export class FakeTenantContextService {
  /** Set to null to simulate a business row that does not exist. */
  businessName: string | null = "All Phase Plumbing";

  async run<T>(_tenantId: string, work: (db: never) => Promise<T>): Promise<T> {
    const db = {
      business: {
        findUnique: async (): Promise<{ name: string } | null> =>
          this.businessName === null ? null : { name: this.businessName },
      },
    };
    return work(db as never);
  }
}
