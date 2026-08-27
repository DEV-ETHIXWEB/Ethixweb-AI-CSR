import { Module } from "@nestjs/common";
import { SPEECH_TO_TEXT_PROVIDER } from "./domain/speech-to-text.port";
import { TEXT_TO_SPEECH_PROVIDER } from "./domain/text-to-speech.port";
import { DeepgramSttProvider } from "./infrastructure/deepgram-stt.provider";
import { ElevenLabsTtsProvider } from "./infrastructure/elevenlabs-tts.provider";

@Module({
  providers: [
    { provide: SPEECH_TO_TEXT_PROVIDER, useClass: DeepgramSttProvider },
    { provide: TEXT_TO_SPEECH_PROVIDER, useClass: ElevenLabsTtsProvider },
  ],
  exports: [SPEECH_TO_TEXT_PROVIDER, TEXT_TO_SPEECH_PROVIDER],
})
export class SpeechModule {}
