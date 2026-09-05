/**
 * REAL ElevenLabs TTS latency measurement — completes the streaming
 * pipeline's measured chain as far as this environment can reach without
 * a real phone call (see this repo's voice-latency optimization pass,
 * Phase 2). Uses the ACTUAL `ElevenLabsTtsProvider` — the exact class
 * `CallSessionOrchestrator.speak()` calls on a live call — against the
 * REAL ElevenLabs API, not a fake/mocked timing model.
 *
 * Segments below are deliberately shaped like what
 * `findSpeechSegmentBoundary` (voice-orchestrator) actually produces —
 * short, complete sentences/clauses in the 40-160 character range, not
 * arbitrary lorem ipsum — so this measures the REAL latency this
 * pipeline's own chunks will see, not a best/worst-case a real turn
 * would never actually produce.
 *
 * What this measures: time-to-first-audio-byte (TTFA) and total
 * synthesis time per chunk. What this does NOT measure: the Twilio leg
 * (this audio actually reaching a caller's ear over PSTN) — no code
 * here can originate or receive a real phone call; that boundary is
 * unavoidably BLOCKED without a live test call.
 *
 * Run: pnpm exec ts-node -T scripts/measure-tts-latency.ts
 * (from apps/voice-runtime — needs a real ELEVENLABS_API_KEY and
 * ELEVENLABS_VOICE_ID in this package's .env, the same ones the live
 * service reads)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ElevenLabsTtsProvider } from "../src/modules/speech/infrastructure/elevenlabs-tts.provider";
import { parseDelivery } from "../src/modules/call-session/application/emotional-delivery";
import { DEFAULT_VOICE_DELIVERY_SETTINGS } from "../src/modules/speech/domain/text-to-speech.port";

loadDotEnvIfPresent(join(__dirname, "..", ".env"));

if (!process.env["ELEVENLABS_API_KEY"] || !process.env["ELEVENLABS_VOICE_ID"]) {
  console.error(
    "BLOCKED: ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set. This script measures REAL " +
      "provider latency and refuses to fabricate numbers instead.",
  );
  process.exit(1);
}

/** Realistic chunk-sized segments — the actual shape findSpeechSegmentBoundary (voice-orchestrator) produces, not arbitrary text. */
const SEGMENTS = [
  "I hear you—that's definitely uncomfortable, especially with the heat.",
  "Thanks, Akash. Just to clarify—do you need plumbing services, or were you looking for HVAC help with that air conditioner?",
  "Got it—so that's Akash Kumar at 555-201-4477.",
  "You're welcome, Akash!",
];

/**
 * Emotional-delivery mission item 12: "send real marked-up text, verify
 * the request succeeds, verify streamed audio is produced, verify
 * latency remains acceptable." These run the EXACT text a real turn
 * response could contain — raw, with [bracket] cues still in it — through
 * the REAL parseDelivery() (the same call speak() makes) and then the
 * REAL ElevenLabs API with the resolved non-default voice_settings, not
 * a synthetic voiceSettings object hand-typed for this script.
 */
const MARKED_UP_SEGMENTS = [
  "[sincere, warm] I'm sorry you're dealing with that.",
  "[serious] Okay. If you smell gas, please move everyone outside first.",
  "[relieved] Okay, that's helpful. I think I've got what I need.",
];

async function main(): Promise<void> {
  const tts = new ElevenLabsTtsProvider();
  const results: Array<{ text: string; ttfaMs: number; totalMs: number; chunkCount: number }> = [];

  for (const text of SEGMENTS) {
    const startedAt = Date.now();
    let firstChunkAt: number | null = null;
    let chunkCount = 0;
    for await (const chunk of tts.synthesize(text)) {
      if (firstChunkAt === null) {
        firstChunkAt = Date.now();
      }
      chunkCount += 1;
      void chunk;
    }
    const totalMs = Date.now() - startedAt;
    const ttfaMs = (firstChunkAt ?? Date.now()) - startedAt;
    results.push({ text, ttfaMs, totalMs, chunkCount });
    console.log(`"${text}" (${text.length} chars)`);
    console.log(`  TTFA: ${ttfaMs}ms | total: ${totalMs}ms | audio chunks: ${chunkCount}\n`);
  }

  const ttfaValues = results.map((r) => r.ttfaMs);
  const totalValues = results.map((r) => r.totalMs);
  console.log("=== SUMMARY (real ElevenLabs API, default voice_settings) ===");
  console.log(
    `TTFA (ms): min=${Math.min(...ttfaValues)} max=${Math.max(...ttfaValues)} avg=${avg(ttfaValues).toFixed(0)}`,
  );
  console.log(
    `Total synthesis (ms): min=${Math.min(...totalValues)} max=${Math.max(...totalValues)} avg=${avg(totalValues).toFixed(0)}`,
  );

  console.log(
    "\n=== EMOTIONAL DELIVERY: real marked-up text through parseDelivery() + real ElevenLabs ===",
  );
  const markedResults: Array<{ text: string; ttfaMs: number; totalMs: number; bytes: number }> = [];
  for (const raw of MARKED_UP_SEGMENTS) {
    const { voiceSettings, segments } = parseDelivery(raw);
    const isDefault =
      JSON.stringify(voiceSettings) === JSON.stringify(DEFAULT_VOICE_DELIVERY_SETTINGS);
    console.log(`raw:    "${raw}"`);
    console.log(`spoken: "${segments.map((s) => s.text).join(" <pause> ")}"`);
    console.log(
      `voice_settings: ${JSON.stringify(voiceSettings)}${isDefault ? "  [WARNING: resolved to DEFAULT — cue was not recognized]" : "  [non-default — cue WAS applied]"}`,
    );
    for (const segment of segments) {
      const startedAt = Date.now();
      let firstChunkAt: number | null = null;
      let totalBytes = 0;
      for await (const chunk of tts.synthesize(segment.text, undefined, voiceSettings)) {
        if (firstChunkAt === null) {
          firstChunkAt = Date.now();
        }
        totalBytes += chunk.length;
      }
      const totalMs = Date.now() - startedAt;
      const ttfaMs = (firstChunkAt ?? Date.now()) - startedAt;
      markedResults.push({ text: segment.text, ttfaMs, totalMs, bytes: totalBytes });
      console.log(
        `  segment "${segment.text}" -> TTFA ${ttfaMs}ms, total ${totalMs}ms, ${totalBytes} audio bytes received`,
      );
    }
    console.log("");
  }
  const anyZeroBytes = markedResults.some((r) => r.bytes === 0);
  console.log(
    anyZeroBytes
      ? "RESULT: at least one marked-up segment produced ZERO audio bytes — investigate before trusting this path live."
      : "RESULT: every marked-up segment produced real audio bytes from the real ElevenLabs API with its resolved voice_settings.",
  );
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function loadDotEnvIfPresent(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

main().catch((error: unknown) => {
  console.error("Measurement run failed:", error);
  process.exit(1);
});
