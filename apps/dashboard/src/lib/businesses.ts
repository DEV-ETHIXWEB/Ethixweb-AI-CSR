import { coreApiFetch } from "./core-api-client";

export interface Business {
  id: string;
  name: string;
  timezone: string;
  crmType: string;
  status: string;
}

/**
 * core-api has no user<->business assignment table (confirmed by audit) —
 * every authenticated user of a tenant can see every business under that
 * tenant via GET /v1/businesses; there is no per-user filtering to expect
 * or replicate here. A tenant with exactly one business skips the picker
 * (see BusinessSwitcher); a tenant with several requires an explicit
 * selection, persisted as a query param rather than server state, since
 * core-api itself has no "current business" concept for a session.
 */
export async function listBusinesses(): Promise<Business[]> {
  return coreApiFetch<Business[]>("/businesses");
}
