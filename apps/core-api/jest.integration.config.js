/**
 * Integration tests against a real Postgres/Redis via testcontainers
 * (docs/14-backend-stack-and-code-standards.md §6). Requires Docker — not
 * runnable in every environment (e.g. this scaffold's own sandbox has no
 * Docker daemon), which is why these are a separate, explicitly-invoked
 * config rather than bundled into the default unit-test run.
 */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "test/integration",
  testRegex: ".*\\.integration-spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  testEnvironment: "node",
  // Generous default: container startup (image pull on a cold cache +
  // Postgres init) can take well over the unit-test-appropriate 30s,
  // independent of the explicit 120s override on the migration-applying
  // `beforeAll` hook itself.
  testTimeout: 60000,
};
