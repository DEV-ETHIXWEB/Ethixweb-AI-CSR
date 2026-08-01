import { Module } from "@nestjs/common";
import { CircuitBreakerRegistry } from "@ethixweb/shared-kernel";
import { AI_PROVIDER_ROUTER, type AiProviderPort } from "./domain/ai-provider.port";
import { AnthropicAdapter } from "./infrastructure/anthropic.adapter";
import { FallbackAiProvider } from "./infrastructure/fallback-ai-provider";
import { GeminiAdapter } from "./infrastructure/gemini.adapter";
import { OpenAiAdapter } from "./infrastructure/openai.adapter";

const DEFAULT_PROVIDER_ORDER = ["openai", "anthropic", "gemini"];

/**
 * Providers are constructed only when their API key is configured — an
 * unconfigured vendor is simply absent from the fallback chain rather than
 * present-but-always-failing, so `AI_PROVIDER_FALLBACK_ORDER` (default
 * openai,anthropic,gemini) lets an operator reorder or narrow which
 * vendors this deployment actually tries, per docs/21's provider-swap
 * requirement.
 */
@Module({
  providers: [
    {
      provide: AI_PROVIDER_ROUTER,
      useFactory: (): AiProviderPort => {
        const available = new Map<string, AiProviderPort>();
        const openAiKey = process.env["OPENAI_API_KEY"];
        if (openAiKey) {
          available.set("openai", new OpenAiAdapter(openAiKey, process.env["OPENAI_BASE_URL"]));
        }
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];
        if (anthropicKey) {
          available.set(
            "anthropic",
            new AnthropicAdapter(anthropicKey, process.env["ANTHROPIC_BASE_URL"]),
          );
        }
        const geminiKey = process.env["GEMINI_API_KEY"];
        if (geminiKey) {
          available.set("gemini", new GeminiAdapter(geminiKey, process.env["GEMINI_BASE_URL"]));
        }

        const order = (
          process.env["AI_PROVIDER_FALLBACK_ORDER"] ?? DEFAULT_PROVIDER_ORDER.join(",")
        )
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name.length > 0);
        const orderedProviders = order
          .map((name) => available.get(name))
          .filter((provider): provider is AiProviderPort => provider !== undefined);

        return new FallbackAiProvider(orderedProviders, new CircuitBreakerRegistry());
      },
    },
  ],
  exports: [AI_PROVIDER_ROUTER],
})
export class AiProviderModule {}
