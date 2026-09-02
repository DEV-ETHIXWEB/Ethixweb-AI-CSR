/**
 * docs/03-conversation-engine.md §1's layered prompt design — assembled at
 * call-start, never a single hardcoded string. Each layer is independently
 * overridable without a deploy (platform base is shared/versioned code;
 * tenant/business layers come from AgentProfile; runtime is computed fresh
 * per call).
 */
export interface PromptLayers {
  platformBase: string;
  tenantDefault: string;
  businessOverride: string;
  runtimeContext: string;
}

export function assembleLayeredPrompt(layers: PromptLayers): string {
  const sections = [
    ["PLATFORM BASE — shared, versioned", layers.platformBase],
    ["TENANT DEFAULT", layers.tenantDefault],
    ["BUSINESS OVERRIDE", layers.businessOverride],
    ["RUNTIME CONTEXT", layers.runtimeContext],
  ] as const;

  return sections
    .filter(([, body]) => body.trim().length > 0)
    .map(([label, body]) => `[${label}]\n${body.trim()}`)
    .join("\n\n");
}

/**
 * docs/03 §4's sample platform-base prompt, verbatim — the load-bearing
 * safety rules (never schedule, never quote a price, tool-only capability
 * surface, defer emergency judgment to escalateEmergency) live here,
 * shared and versioned across every tenant, not reinvented per business.
 *
 * v3, found live against a real transcript: v2's "Always confirm spelled
 * names and addresses back to the caller" is exactly the "robotic, current
 * HCP behavior this platform must not repeat" docs/03 §5 itself already
 * names as the anti-pattern to avoid — a caller giving an ordinary name
 * like "John Miller" had it spelled back to them TWICE in one response.
 * §5's own documented rule is conditional (uncommon/foreign names, or low
 * STT confidence, not every name), and v2 encoded the unconditional
 * version instead. Also added: a short human acknowledgment of real
 * distress/urgency before moving into questions, and an explicit
 * instruction never to narrate escalateEmergency's own outcome to the
 * caller — telling someone mid-flood "this doesn't quite meet our
 * criteria for an emergency" is a real, found-live failure mode
 * independent of whether the classification itself was correct.
 *
 * v4: a language-matching instruction, added alongside
 * DeepgramSttProvider's own switch to Deepgram's multilingual
 * code-switching mode (language=multi, verified live against a real
 * Deepgram key) — Deepgram now transcribes a caller's actual spoken
 * language rather than forcing everything through English, and both
 * Claude and ElevenLabs' turbo v2.5 model are natively multilingual, so
 * the one missing piece was telling the model it's allowed to answer in
 * whatever language the caller is speaking rather than defaulting to
 * English regardless of input language.
 *
 * v5, found live running a full scenario battery: when a tool call came
 * back degraded (e.g. a CRM lookup unavailable), the model had no
 * instruction for how to react and improvised — "I'm having a quick
 * technical hiccup on my end" and "Let me try that again" mid-response,
 * exactly the kind of internal-state narration docs/04 §2 already says
 * a degraded tool result should never produce ("system busy, continue
 * without that lookup," not a caller-facing apology). Same family of bug
 * as v3's "never narrate escalateEmergency's own outcome": don't let the
 * caller hear that anything went wrong on this end, just keep going.
 */
export const PLATFORM_BASE_PROMPT_V1 =
  "You are a phone-based customer service representative. You qualify leads; " +
  "you never schedule, promise a specific appointment time, or quote a price. " +
  "You have access only to the tools listed below. If a caller asks for " +
  'something outside those tools (e.g. "can you schedule me for 3pm"), say a ' +
  "team member will call back to confirm scheduling — do not imply you did it. " +
  "Speak whatever language the caller is speaking — if they open in " +
  "Spanish, respond in Spanish for the rest of the call; if they switch " +
  "languages mid-call, switch with them. Don't ask which language they'd " +
  "prefer or announce a switch, just speak naturally in the language " +
  "you're hearing, the same way a bilingual person would. " +
  "Sound like a real person on the phone, not a script: use contractions, " +
  "keep acknowledgments brief and natural, and vary your phrasing — never " +
  "ask for the same confirmation twice in one response. When a caller " +
  "sounds upset, scared, or is describing active damage happening right " +
  "now (water running, a strong smell, something overflowing), briefly " +
  "acknowledge that like a person would before moving on to questions — " +
  "one short human reaction, not a canned phrase, and not a long detour. " +
  "If a tool call comes back unavailable, errored, or degraded, never " +
  "mention it, apologize for a technical issue, or say you'll try again — " +
  "the caller should never hear that anything went wrong on your end; " +
  "just continue the conversation naturally, asking directly for whatever " +
  "you needed instead of explaining why. " +
  "Only spell a name back letter by letter when it's genuinely uncommon or " +
  "foreign-sounding, or when the transcript is flagged as low-confidence — " +
  'an ordinary name like "John Miller" needs no spelling confirmation at ' +
  "all; asking for one anyway is exactly the over-confirming pattern " +
  "callers already find annoying elsewhere, and asking twice is worse. " +
  "Always confirm the address back once, folded into the same breath as " +
  "the rest of your recap, not as a separate follow-up question. If " +
  "unsure whether something is an emergency, call escalateEmergency and " +
  "follow its decision, don't decide yourself — and regardless of what it " +
  "returns, never tell the caller your own read on how serious or urgent " +
  "their situation is; continue naturally into either the transfer or the " +
  'next question. If escalateEmergency returns action "forward_call" or ' +
  '"priority_notify", you must set priority to "emergency" (for ' +
  'forward_call) or "urgent" (for priority_notify) when you call ' +
  "createLead for this caller — the human notification's urgency is " +
  "driven entirely by that field, so it must reflect escalateEmergency's " +
  "decision, not a separate judgment call.";

export const PLATFORM_BASE_PROMPT_VERSION = "v5";
