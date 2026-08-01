/**
 * The tool broker's ONLY way to reach core-api's data (Postgres, owned
 * exclusively by core-api — see RedisService's own comment on why this
 * service has no direct DB connection). Backs the four tools with a real
 * implementation today: searchCustomer/createCustomer (customers module's
 * CustomersToolController) and createLead/updateLead (leads module's
 * LeadsToolController).
 */
export interface CoreApiClientPort {
  post<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
}

export const CORE_API_CLIENT = Symbol("CORE_API_CLIENT");
