import { ValidationPipe, type CanActivate } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { HandleSmsClaimReplyUseCase } from "../application/handle-sms-claim-reply.use-case";
import { TwilioSignatureGuard } from "./guards/twilio-signature.guard";
import { SmsWebhooksController } from "./sms-webhooks.controller";

/**
 * Regression test for a real, previously-shipped production bug: Twilio's
 * real inbound SMS webhook always includes fields SmsClaimReplyDto doesn't
 * declare (AccountSid, SmsSid, NumMedia, NumSegments, ApiVersion, ...), and
 * main.ts's global ValidationPipe sets `forbidNonWhitelisted: true` — which
 * REJECTS any request containing an undeclared property. Boots a real Nest
 * app with that EXACT global pipe config (not a hand-rolled approximation)
 * so this test actually exercises the interaction that broke — a plain
 * unit test calling the controller method directly would never see the
 * global pipe at all and would have missed this bug entirely. Uses
 * Fastify's own `.inject()` rather than supertest (not a project
 * dependency) to drive a real HTTP request through the real pipe/guard
 * pipeline without binding a real port.
 */
describe("SmsWebhooksController (global ValidationPipe integration)", () => {
  let app: NestFastifyApplication;
  const handleSmsClaimReply = { execute: jest.fn() };
  const allowAllGuard: CanActivate = { canActivate: () => true };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SmsWebhooksController],
      providers: [{ provide: HandleSmsClaimReplyUseCase, useValue: handleSmsClaimReply }],
    })
      .overrideGuard(TwilioSignatureGuard)
      .useValue(allowAllGuard)
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Identical to main.ts's own global pipe registration — the whole point
    // of this test is to prove the controller survives THIS exact config.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handleSmsClaimReply.execute.mockReset();
  });

  it("accepts a realistic Twilio payload carrying fields SmsClaimReplyDto never declared", async () => {
    handleSmsClaimReply.execute.mockResolvedValue({ status: "no_mapping" });

    const response = await app.inject({
      method: "POST",
      url: "/webhooks/sms/claim-reply",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        From: "+15551234567",
        To: "+15559999999",
        Body: "CLAIM",
        MessageSid: "SM00000000000000000000000000000000",
        AccountSid: "AC00000000000000000000000000000000",
        SmsSid: "SM00000000000000000000000000000000",
        SmsStatus: "received",
        NumMedia: "0",
        NumSegments: "1",
        ApiVersion: "2010-04-01",
      }).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(handleSmsClaimReply.execute).toHaveBeenCalledWith("+15551234567", "CLAIM");
  });

  it("still rejects a genuinely invalid field with 400", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/sms/claim-reply",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        From: "not-a-phone-number",
        To: "+15559999999",
        Body: "CLAIM",
        MessageSid: "SM00000000000000000000000000000000",
      }).toString(),
    });

    expect(response.statusCode).toBe(400);
    expect(handleSmsClaimReply.execute).not.toHaveBeenCalled();
  });
});
