import { ArgumentsHost, Catch, Inject, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CAPACITY_CONFIG_PROVIDER, type CapacityConfigProvider } from "../domain/capacity-config";
import { CapacityExceededError } from "../domain/errors";
import { selectBrochureSegment } from "../domain/brochure-rotation";

interface StartConversationRequestBody {
  tenantId?: string;
  businessId?: string;
}

/**
 * Scoped `@Catch(CapacityExceededError)` filter, deliberately separate
 * from the app-wide `DomainExceptionFilter` (shared/http) rather than
 * making that generic filter aware of per-error-type response bodies —
 * every other DomainError in this app has a flat {statusCode,message,error}
 * shape and stays that way. This is the one error type whose response body
 * the Voice Runtime needs to actually ACT on (docs/36 §4): the brochure's
 * first segment (if the tenant has one configured) and the overflow
 * number (if configured), both attached directly to the 429 so the
 * runtime never needs a second round-trip while a caller is genuinely
 * waiting to be admitted.
 */
@Catch(CapacityExceededError)
export class CapacityExceededFilter implements ExceptionFilter {
  constructor(
    @Inject(CAPACITY_CONFIG_PROVIDER) private readonly capacityConfig: CapacityConfigProvider,
  ) {}

  async catch(exception: CapacityExceededError, host: ArgumentsHost): Promise<void> {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    response.header("Retry-After", String(exception.retryAfterSeconds));

    const body = request.body as StartConversationRequestBody | undefined;
    const businessId = body?.businessId;

    // businessId is required to look up brochure config — if the request
    // body is malformed enough not to have it, this falls back to the
    // plain error shape rather than throwing a second error from inside
    // an error handler.
    const brochure = businessId
      ? await this.capacityConfig
          .getActiveConfig(exception.tenantId, businessId)
          .then((config) => ({
            segment: selectBrochureSegment(config.brochure, 0),
            overflowNumber: config.overflowNumber,
          }))
          .catch(() => null)
      : null;

    response.status(exception.httpStatus).send({
      statusCode: exception.httpStatus,
      message: exception.message,
      error: exception.name,
      scope: exception.scope,
      retryAfterSeconds: exception.retryAfterSeconds,
      // docs/36 §9: never simply disconnect. The runtime should play this
      // segment (if present) or a neutral short phrase, retry shortly, and
      // fall back to overflowNumber only if waiting genuinely times out
      // per its own configured waitingTimeoutMs — this service does not
      // hold the HTTP request open to enforce that timeout itself (see
      // StartConversationUseCase's own comment on why).
      waitingExperience: {
        brochureSegment: brochure?.segment ?? null,
        overflowNumber: brochure?.overflowNumber ?? null,
      },
    });
  }
}
