/** Unit tests only — domain/application/infrastructure layers with fakes, no real network/Twilio/Deepgram/ElevenLabs. Mirrors apps/voice-orchestrator/jest.config.js. */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
};
