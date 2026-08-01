/**
 * docs/03 §7: "The closing is itself a config template
 * (`agent_configs.prompt_config.closing_template`) with variable
 * interpolation, not a hardcoded string." `{{variable}}` substitution —
 * intentionally NOT a general template engine (no conditionals/loops):
 * the closing script is one sentence with a handful of named slots, and a
 * full template language would be unused complexity for that.
 */
export function renderClosingTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.hasOwn(variables, key) ? (variables[key] as string) : match,
  );
}

/** docs/03 §7's own sample template, used as the platform default when a business hasn't configured its own. */
export const DEFAULT_CLOSING_TEMPLATE =
  "Alright {{callerName}}, I've got everything down — {{problemSummary}} at " +
  "{{address}}, and I've flagged this as {{priority}}. Our team will reach out " +
  "{{expectedTimeframe}}. Is there anything else before I let you go?";
