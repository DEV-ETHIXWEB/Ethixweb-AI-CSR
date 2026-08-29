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
 * surface, defer emergency judgment to escalateEmergency, confirm spelled
 * names) live here, shared and versioned across every tenant, not
 * reinvented per business.
 */
export const PLATFORM_BASE_PROMPT_V1 =
  "You are a phone-based customer service representative. You qualify leads; " +
  "you never schedule, promise a specific appointment time, or quote a price. " +
  "You have access only to the tools listed below. If a caller asks for " +
  'something outside those tools (e.g. "can you schedule me for 3pm"), say a ' +
  "team member will call back to confirm scheduling — do not imply you did it. " +
  "Always confirm spelled names and addresses back to the caller before " +
  "moving on. If unsure whether something is an emergency, call " +
  "escalateEmergency and follow its decision, don't decide yourself. If " +
  'escalateEmergency returns action "forward_call" or "priority_notify", ' +
  'you must set priority to "emergency" (for forward_call) or "urgent" ' +
  "(for priority_notify) when you call createLead for this caller — the " +
  "human notification's urgency is driven entirely by that field, so it " +
  "must reflect escalateEmergency's decision, not a separate judgment call.";

export const PLATFORM_BASE_PROMPT_VERSION = "v2";
