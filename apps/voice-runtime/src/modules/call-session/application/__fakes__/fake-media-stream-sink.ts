import type { MediaStreamSink } from "../../domain/media-stream-sink.port";

export class FakeMediaStreamSink implements MediaStreamSink {
  readonly audioSent: Buffer[] = [];
  clearCount = 0;
  readonly marksSent: string[] = [];
  closed = false;

  sendAudio(chunk: Buffer): void {
    this.audioSent.push(chunk);
  }

  clearQueuedAudio(): void {
    this.clearCount += 1;
  }

  sendMark(name: string): void {
    this.marksSent.push(name);
  }

  close(): void {
    this.closed = true;
  }
}
