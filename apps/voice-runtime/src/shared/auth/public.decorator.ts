import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/** Opts a route out of any globally-applied auth guard — health checks and the Twilio webhook (which authenticates via TwilioSignatureGuard instead, since Twilio can never present this platform's own service bearer token). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
