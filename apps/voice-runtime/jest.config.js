/** Unit tests only — orchestrator client + turn/barge-in glue, LiveKit SDK surfaces mocked. Mirrors apps/voice-orchestrator/jest.config.js, adjusted for this package's ESM module type (required by @livekit/agents). */
export default {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  extensionsToTreatAsEsm: [".ts"],
  transform: {
    // ignoreCodes 151002: ts-jest's own suggested fix (isolatedModules in
    // tsconfig.json) breaks this project's NodeNext ESM output instead of
    // just silencing the warning — this is the harmless, correct suppression.
    "^.+\\.ts$": ["ts-jest", { useESM: true, diagnostics: { ignoreCodes: [151002] } }],
  },
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
};
