import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError, TooManyRequestsDomainError } from "../domain/domain-error";

/** Identical to apps/core-api's DomainExceptionFilter. */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
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
