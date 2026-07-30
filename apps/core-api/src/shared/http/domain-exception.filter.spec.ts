import type { ArgumentsHost } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { NotFoundDomainError, TooManyRequestsDomainError } from "../domain/domain-error";
import { DomainExceptionFilter } from "./domain-exception.filter";

class TestNotFoundError extends NotFoundDomainError {
  constructor() {
    super("not found");
    this.name = "TestNotFoundError";
  }
}

class TestRateLimitError extends TooManyRequestsDomainError {
  constructor(public readonly retryAfterSeconds: number) {
    super("too many requests");
    this.name = "TestRateLimitError";
  }
}

// Mocks are kept as plain, un-cast `jest.Mock` references and asserted on
// directly — accessing them back off the `FastifyReply`-typed `reply`
// object instead would trip @typescript-eslint/unbound-method, since that
// rule judges by the interface's static method signature, not the runtime
// jest.fn() actually assigned to it.
function buildMockHost(): {
  host: ArgumentsHost;
  headerMock: jest.Mock;
  statusMock: jest.Mock;
  sendMock: jest.Mock;
} {
  const headerMock = jest.fn().mockReturnThis();
  const statusMock = jest.fn().mockReturnThis();
  const sendMock = jest.fn().mockReturnThis();
  const reply = {
    header: headerMock,
    status: statusMock,
    send: sendMock,
  } as unknown as FastifyReply;
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { host, headerMock, statusMock, sendMock };
}

describe("DomainExceptionFilter", () => {
  it("maps a domain error to its declared httpStatus and a structured body", () => {
    const filter = new DomainExceptionFilter();
    const { host, statusMock, sendMock } = buildMockHost();

    filter.catch(new TestNotFoundError(), host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(sendMock).toHaveBeenCalledWith({
      statusCode: 404,
      message: "not found",
      error: "TestNotFoundError",
    });
  });

  it("does not set a Retry-After header for a non-429 error", () => {
    const filter = new DomainExceptionFilter();
    const { host, headerMock } = buildMockHost();

    filter.catch(new TestNotFoundError(), host);

    expect(headerMock).not.toHaveBeenCalled();
  });

  it("sets a standards-compliant Retry-After header for a 429 rate-limit error", () => {
    const filter = new DomainExceptionFilter();
    const { host, headerMock, statusMock } = buildMockHost();

    filter.catch(new TestRateLimitError(42), host);

    expect(headerMock).toHaveBeenCalledWith("Retry-After", "42");
    expect(statusMock).toHaveBeenCalledWith(429);
  });
});
