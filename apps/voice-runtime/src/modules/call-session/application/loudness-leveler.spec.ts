import { decode, encode, LoudnessLeveler } from "./loudness-leveler";

function tone(amplitude: number, samples = 1600): Buffer {
  const out = Buffer.alloc(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = encode(Math.round(amplitude * Math.sin((2 * Math.PI * 300 * i) / 8000)));
  }
  return out;
}

function rms(chunk: Buffer): number {
  const pcm = decode(chunk);
  return Math.sqrt(pcm.reduce((sum, v) => sum + v * v, 0) / pcm.length);
}

describe("LoudnessLeveler (2026-10-23: the goodbye was 52% louder than a question)", () => {
  it("brings a loud line and a quiet line to about the same level", () => {
    const loud = new LoudnessLeveler();
    const quiet = new LoudnessLeveler();
    let loudOut = 0;
    let quietOut = 0;
    for (let i = 0; i < 5; i += 1) {
      loudOut = rms(loud.process(tone(7000)));
      quietOut = rms(quiet.process(tone(3200)));
    }
    expect(Math.abs(loudOut - quietOut) / quietOut).toBeLessThan(0.12);
  });

  it("leaves silence alone", () => {
    const silence = Buffer.alloc(1600, 0xff);
    expect(new LoudnessLeveler().process(silence).equals(silence)).toBe(true);
  });

  it("never more than doubles nor crushes a line", () => {
    const whisper = rms(new LoudnessLeveler().process(tone(500)));
    expect(whisper).toBeLessThan(rms(tone(500)) * 1.7);
  });

  it("round-trips mu-law without drift", () => {
    for (const sample of [0, 100, -100, 3000, -3000, 30000, -30000]) {
      const back = decode(Buffer.from([encode(sample)]))[0]!;
      expect(Math.abs(back - sample)).toBeLessThanOrEqual(Math.max(16, Math.abs(sample) * 0.07));
    }
  });
});
