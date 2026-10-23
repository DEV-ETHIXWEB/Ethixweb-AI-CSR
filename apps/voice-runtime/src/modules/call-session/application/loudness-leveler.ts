/**
 * Evens out how loud Grace is from one sentence to the next.
 *
 * 2026-10-23, client: "in the end it still gets loud abnormally like alright
 * have a great day, it's very loud comparatively". Measured with the live
 * voice and settings: "Alright, have a great day, Sarah!" came out 52% louder
 * than an ordinary question, and the slowed-down address readback 28%
 * quieter, so the goodbye that followed a readback was about twice as loud.
 * ElevenLabs renders short, exclamatory lines with more energy, and no voice
 * setting holds the level steady.
 *
 * So the audio itself is leveled on its way to the caller: each chunk's
 * loudness is measured over its voiced frames only (silence must not drag
 * the estimate down), a smoothed running level is kept for the utterance,
 * and the chunk is scaled toward one target. The gain is bounded, so a
 * whisper is not blown up and nothing is crushed, and samples are clipped
 * rather than wrapped.
 */
const TARGET_RMS = 3300;
const MIN_GAIN = 0.6;
const MAX_GAIN = 1.6;
const SMOOTHING = 0.6;
const FRAME_SAMPLES = 160;
const VOICED_FLOOR = 300;
const MAX_SAMPLE = 32635;

export class LoudnessLeveler {
  private level: number | null = null;

  process(chunk: Buffer): Buffer {
    const pcm = decode(chunk);
    const voiced = voicedRms(pcm);
    if (voiced === null) {
      return chunk;
    }
    this.level = this.level === null ? voiced : SMOOTHING * this.level + (1 - SMOOTHING) * voiced;
    const gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, TARGET_RMS / this.level));
    if (Math.abs(gain - 1) < 0.02) {
      return chunk;
    }
    const out = Buffer.alloc(chunk.length);
    for (let i = 0; i < pcm.length; i += 1) {
      const scaled = Math.max(-MAX_SAMPLE, Math.min(MAX_SAMPLE, Math.round(pcm[i]! * gain)));
      out[i] = encode(scaled);
    }
    return out;
  }
}

function voicedRms(pcm: Int16Array): number | null {
  let total = 0;
  let frames = 0;
  for (let start = 0; start + FRAME_SAMPLES <= pcm.length; start += FRAME_SAMPLES) {
    let sum = 0;
    for (let i = start; i < start + FRAME_SAMPLES; i += 1) {
      sum += pcm[i]! * pcm[i]!;
    }
    const rms = Math.sqrt(sum / FRAME_SAMPLES);
    if (rms > VOICED_FLOOR) {
      total += rms;
      frames += 1;
    }
  }
  return frames === 0 ? null : total / frames;
}

/** G.711 mu-law to 16-bit PCM. */
export function decode(chunk: Buffer): Int16Array {
  const out = new Int16Array(chunk.length);
  for (let i = 0; i < chunk.length; i += 1) {
    const u = ~chunk[i]! & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    out[i] = sign ? -magnitude : magnitude;
  }
  return out;
}

/** 16-bit PCM to G.711 mu-law. */
export function encode(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.min(Math.abs(sample), MAX_SAMPLE) + 0x84;
  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
