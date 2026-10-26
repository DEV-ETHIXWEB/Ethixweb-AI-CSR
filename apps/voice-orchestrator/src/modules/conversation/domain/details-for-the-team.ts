import { collapseSpokenDigits } from "./service-area";

/**
 * 2026-10-26, the client's test scripts on the production model: a son
 * calling for his mother gave her name and her separate number, and another
 * caller gave her gate code. The prompt asks for both in problem_summary, the
 * only text the team reads, and the model still left them out. A caller
 * sentence about someone else's name or number, or an access code, is added
 * to the summary word for word when the summary does not already carry it.
 */
const FOR_THE_TEAM =
  /\b(?:her|his|their) (?:name|number|phone|cell)\b|\b(?:gate|door|access|entry|lock ?box|garage|building|alarm) code\b/i;
const SOMEONE_ELSES_NAME = /\b(?:her|his|their) name is ([a-z]+)/i;
const MAX_ADDED = 3;

export function detailsForTheTeam(
  callerTexts: readonly string[],
  summary: string,
  callerFirstName: string | null = null,
): string {
  const summaryDigits = collapseSpokenDigits(summary.toLowerCase())
    .replace(/[^\d\s]/g, " ")
    .replace(/(\d)[\s]+(?=\d)/g, "$1");
  const summaryLower = summary.toLowerCase();
  const added: string[] = [];
  for (const text of callerTexts) {
    for (const sentence of text.split(/(?<=[.?!])\s+/)) {
      if (added.length >= MAX_ADDED || !FOR_THE_TEAM.test(sentence)) {
        continue;
      }
      const runs = collapseSpokenDigits(sentence.toLowerCase()).match(/\d[\d-]{2,}\d/g) ?? [];
      const digits = runs.map((run) => run.replace(/\D/g, ""));
      const name = SOMEONE_ELSES_NAME.exec(sentence)?.[1]?.toLowerCase();
      // "his name is trevor", answering "What's your name?", was the caller.
      const alreadyThere =
        digits.length > 0
          ? digits.every((run) => summaryDigits.includes(run))
          : name !== undefined &&
            (summaryLower.includes(name) || name === callerFirstName?.toLowerCase());
      if (!alreadyThere) {
        added.push(sentence.trim().slice(0, 200));
      }
    }
  }
  return added.map((sentence) => ` [Caller also said: "${sentence}"]`).join("");
}
