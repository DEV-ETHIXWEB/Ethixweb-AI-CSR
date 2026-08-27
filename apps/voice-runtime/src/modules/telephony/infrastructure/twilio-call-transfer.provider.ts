import { Injectable } from "@nestjs/common";
import type { CallTransferProvider } from "../domain/call-transfer.port";

/**
 * [Unverified against a live Twilio account/SIP trunk in this environment —
 * same posture as call-transfer.port.ts's own comment and this repo's
 * existing TwilioSignatureGuard caveat.] Uses Twilio's documented
 * call-modification REST endpoint (`POST
 * /2010-04-01/Accounts/{AccountSid}/Calls/{CallSid}.json` with a `Twiml`
 * body param containing a fresh `<Dial>`) to redirect an in-progress call —
 * this is Twilio's own documented mechanism for changing a live call's
 * behavior after it has already answered, not a guess. No `twilio` SDK
 * dependency: this is one REST call with HTTP Basic auth
 * (AccountSid:AuthToken, Twilio's own documented auth scheme for this API),
 * not worth a dependency for.
 */
@Injectable()
export class TwilioCallTransferProvider implements CallTransferProvider {
  async transferCall(callSid: string, destination: string): Promise<void> {
    const accountSid = process.env["TWILIO_ACCOUNT_SID"];
    const authToken = process.env["TWILIO_AUTH_TOKEN"];
    if (!accountSid || !authToken) {
      throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured");
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial>${escapeXml(destination)}</Dial></Response>`;
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ Twiml: twiml }).toString(),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Twilio call-transfer failed (${response.status}): ${text}`);
    }
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
