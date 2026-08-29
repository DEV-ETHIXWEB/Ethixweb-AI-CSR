/**
 * `$executeRaw` is a no-op stub (not `undefined`) so callers that issue
 * SAVEPOINT/ROLLBACK TO SAVEPOINT around a create-then-recover race (e.g.
 * StartCallUseCase — see its own comment on why a real Postgres SAVEPOINT
 * is required there) don't crash here; a fake has no real transaction to
 * poison in the first place, so a no-op is the correct behavior, not a
 * workaround.
 */
export class FakeTenantContextService {
  async run<T>(_tenantId: string, work: (db: never) => Promise<T>): Promise<T> {
    const fakeDb = { $executeRaw: async () => 0 };
    return work(fakeDb as never);
  }
}
