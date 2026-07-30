import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError, TooManyRequestsDomainError } from "../domain/domain-error";

@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    // Standards-compliant `Retry-After` (RFC 9110 §10.2.3) — found missing
    // during a review: RateLimitExceededError already carries
    // retryAfterSeconds as a typed field, but the generic {statusCode,
    // message, error} body below only ever serialized it as prose inside
    // `message`, leaving callers (and any CDN/gateway that respects this
    // header automatically) with no structured way to know when to retry.
    if (exception instanceof TooManyRequestsDomainError) {
      response.header("Retry-After", String(exception.retryAfterSeconds));
    }
    response.status(exception.httpStatus).send({
      statusCode: exception.httpStatus,
      message: exception.message,
      error: exception.name,
    });
  }
}
