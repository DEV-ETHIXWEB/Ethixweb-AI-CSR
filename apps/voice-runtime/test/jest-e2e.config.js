/**
 * The local call simulator's scripted scenarios (test/local-call-simulator.ts)
 * driven as real Jest specs — no live Twilio/Deepgram/ElevenLabs credentials,
 * same "boot the real module graph, fake only true external I/O" discipline
 * as apps/voice-orchestrator/test/voice-runtime-simulator.ts. Separate rootDir
 * from jest.config.js's unit tests for the same reason that file is separate
 * in voice-orchestrator: this needs `test/` on its path, not just `src/`.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "..",
  testRegex: "test/.*\\.e2e\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  testEnvironment: "node",
  testTimeout: 15000,
};
