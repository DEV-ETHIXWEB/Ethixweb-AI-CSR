/**
 * The Voice Runtime contract simulator — boots the real AppModule over real
 * HTTP (Fastify `.inject()`), overriding only true external I/O (Redis, AI
 * provider, core-api client). Separate from jest.config.js's unit tests
 * because it needs `test/` on its rootDir, not just `src/`.
 *
 * `--runInBand` (package.json's test:e2e script) is deliberate: each test
 * boots a full Nest application (its own Fastify instance, its own
 * ioredis-mock client), and running the suite in parallel workers would
 * multiply that boot cost for no isolation benefit `afterEach`'s
 * `sim.close()` doesn't already provide. Node's default 10-listener cap on
 * `process` gets exceeded across ~15 sequential app boots/closes in one
 * process (each ioredis-mock instance and Nest's own shutdown hooks add
 * one) — harmless (MaxListenersExceededWarning, not an error), raised here
 * rather than silenced, so a REAL leak introduced later still warns.
 */
process.setMaxListeners(50);

module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "..",
  testRegex: "test/.*\\.e2e-spec\\.ts$|test/.*\\.e2e\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  testEnvironment: "node",
  testTimeout: 15000,
};
