import { Module } from "@nestjs/common";
import { CallSessionModule } from "../call-session/call-session.module";
import { TenantRoutingModule } from "../tenant-routing/tenant-routing.module";
import { MediaStreamGateway } from "./interfaces/media-stream.gateway";
import { TwilioVoiceController } from "./interfaces/twilio-voice.controller";

@Module({
  imports: [CallSessionModule, TenantRoutingModule],
  controllers: [TwilioVoiceController],
  providers: [MediaStreamGateway],
  exports: [MediaStreamGateway],
})
export class TelephonyModule {}
