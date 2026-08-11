export class FakeTenantContextService {
  async run<T>(_tenantId: string, work: (db: never) => Promise<T>): Promise<T> {
    return work(undefined as never);
  }
}
