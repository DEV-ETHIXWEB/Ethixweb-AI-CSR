import type { FastifyRequest } from "fastify";

/**
 * This service has no human user session concept — its only callers are
 * other services (the Voice Runtime posting turn events, core-api reading
 * transcripts) authenticated via a shared service token, per the
 * "REST/webhook, service-to-service" boundary decision for this phase.
 * `tenantId`/`businessId` are NOT derived from this principal the way
 * apps/core-api derives them from a JWT session — they come from the
 * request payload itself (the Voice Runtime already knows which
 * tenant/business a call belongs to from telephony routing at call setup;
 * see docs/02-voice-pipeline-and-telephony.md §4). `ServiceAuthGuard`
 * proves "this caller is a trusted internal service," not "acting as
 * tenant X" — every use-case still independently validates tenantId
 * against the resource it's touching, the same defense-in-depth every
 * other module in this codebase applies.
 */
export interface ServicePrincipal {
  serviceName: string;
}

export interface RequestWithServicePrincipal extends FastifyRequest {
  servicePrincipal?: ServicePrincipal;
}
