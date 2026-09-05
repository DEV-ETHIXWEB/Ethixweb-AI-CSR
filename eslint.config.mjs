// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import prettierConfig from "eslint-config-prettier";

/**
 * Enforces the Hexagonal Architecture layering documented in
 * docs/14-backend-stack-and-code-standards.md §2-3, §7:
 *   domain        -> depends on nothing else in the module
 *   application    -> depends on domain only
 *   infrastructure -> depends on domain + application (implements its ports)
 *   interfaces     -> depends on application only, never infrastructure directly
 * A violation here is not a style nitpick — it's the mechanism that keeps
 * CRM/LLM/voice-vendor swaps additive instead of invasive.
 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/*.js",
      "**/*.mjs",
      "apps/dashboard/.next/**",
      "apps/dashboard/.next-types/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        // Root-level *.config.ts files aren't part of any package's src/
        // tsconfig `include` — without this, typescript-eslint's project
        // service can't type-check them. Listed explicitly, not as a `**`
        // glob: typescript-eslint intentionally rejects globstar patterns
        // here (unbounded-default-project is a known perf footgun), so a
        // new root-level config file must be added to this list by hand.
        projectService: {
          allowDefaultProject: [
            "packages/database/prisma.config.ts",
            "packages/shared-kernel/vitest.config.ts",
            // Standalone CLI dev tools (real-provider latency/quality
            // measurement scripts) — deliberately NOT part of either
            // package's own tsconfig `include` (that's reserved for
            // "src", the compiled application; adding "scripts" there
            // once already broke `nest build`'s output path from
            // dist/main.js to dist/src/main.js, since TS then computes
            // a different common rootDir — see that incident's own
            // commit). ts-node's own `-T` transpile-only mode never
            // needed these listed here at all; this is purely so the
            // project service can type-check them for linting.
            "apps/voice-orchestrator/scripts/measure-streaming-latency.ts",
            "apps/voice-orchestrator/scripts/measure-conversation-quality.ts",
            "apps/voice-orchestrator/scripts/measure-emotional-delivery.ts",
            "apps/voice-runtime/scripts/measure-tts-latency.ts",
            "apps/core-api/scripts/seed-all-phase-knowledge.ts",
            "apps/core-api/scripts/check-tenant-readiness.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { boundaries },
    settings: {
      "boundaries/include": ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      "boundaries/elements": [
        { type: "domain", pattern: "apps/*/src/modules/*/domain/**" },
        { type: "application", pattern: "apps/*/src/modules/*/application/**" },
        { type: "infrastructure", pattern: "apps/*/src/modules/*/infrastructure/**" },
        { type: "interfaces", pattern: "apps/*/src/modules/*/interfaces/**" },
        { type: "module-root", pattern: "apps/*/src/modules/*/*.ts" },
        { type: "shared", pattern: "apps/*/src/shared/**" },
        { type: "kernel-package", pattern: "packages/*/src/**" },
      ],
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      // Off, deliberately: every repository/adapter in this codebase
      // implements a Promise-returning port (docs/14 §2's Hexagonal ports),
      // and a legitimate, recurring subset of implementations — in-memory
      // fakes, trivial pass-through adapters — have nothing to `await`
      // internally while still correctly needing to return a Promise to
      // satisfy the interface. The rule can't distinguish that from a
      // genuine "forgot to await" bug, so it would otherwise be disabled
      // file-by-file across dozens of call sites instead of once, here.
      "@typescript-eslint/require-await": "off",
      // Production code must use the structured logger (packages/shared-kernel),
      // never console.* — the only exceptions are the handful of call sites
      // that run before any logger/DI container exists (main.ts's bootstrap
      // failure handler, tracing.ts before the Nest app starts), which carry
      // their own explicit, justified eslint-disable comments.
      "no-console": "error",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            { from: "domain", allow: ["domain", "shared", "kernel-package"] },
            { from: "application", allow: ["domain", "application", "shared", "kernel-package"] },
            {
              from: "infrastructure",
              allow: ["domain", "application", "infrastructure", "shared", "kernel-package"],
            },
            {
              from: "interfaces",
              allow: ["application", "interfaces", "shared", "kernel-package", "module-root"],
            },
            {
              from: "module-root",
              allow: [
                "domain",
                "application",
                "infrastructure",
                "interfaces",
                "shared",
                "kernel-package",
              ],
            },
            { from: "shared", allow: ["shared", "kernel-package"] },
            { from: "kernel-package", allow: ["kernel-package"] },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "**/test/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "boundaries/element-types": "off",
      // Test doubles for loosely-/un-typed test-only libraries (e.g.
      // ioredis-mock) legitimately surface as `any` to the type checker —
      // the no-unsafe-* family exists to catch that leaking into production
      // code paths, which test files by definition are not.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    // Standalone CLI dev tools (real-provider latency measurement
    // scripts, etc.) run via `ts-node`, never imported by the running
    // application — the `no-console` rule's whole rationale (production
    // code must use the structured logger) doesn't apply: there is no
    // logger/DI container here, only a human reading stdout, exactly
    // like main.ts's own documented bootstrap-time exception above.
    files: ["apps/*/scripts/**/*.ts"],
    rules: {
      "no-console": "off",
      "boundaries/element-types": "off",
    },
  },
);
