import { ArgumentsHost, Catch, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { DomainError } from "../domain/domain-error";

/** Identical to apps/voice-orchestrator's DomainExceptionFilter. */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<FastifyReply>();
    response.status(exception.httpStatus).send({
      statusCode: exception.httpStatus,
      message: exception.message,
      error: exception.name,
    });
  }
}
