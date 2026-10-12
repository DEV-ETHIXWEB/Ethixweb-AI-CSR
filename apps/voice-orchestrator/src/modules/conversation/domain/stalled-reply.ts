/**
 * Client feedback (Prateek, 2026-10-09): "she asked me for some details, and
 * when I gave them, she confirmed the details and then went silent, after
 * some time she started saying 'I am here'".
 *
 * The shape behind it: the model's whole reply is an acknowledgment or a
 * read-back with no question ("Perfect, I have 1 2 3 Main Street, 3 0 3 0 1."),
 * and it calls no tool. Nothing hands the turn back to the caller, so both
 * sides wait, and fifteen seconds later voice-runtime's silence check-in
 * fills the gap with "Take your time. I'm still here." The prompt's "one
 * question OR one statement" shape allows exactly this, and the earlier fix
 * for call 9ecc6846 only covered the case where a backstop tool had run.
 *
 * This decides whether a finished reply left the caller with nothing to
 * answer. Over-triggering costs one extra short question; under-triggering
 * is the dead air the client heard, so it errs toward continuing, but never
 * after a goodbye and never when the reply already invites the caller to
 * talk without a question mark ("go ahead", "please spell that").
 */

const ASKS_OR_INVITES =
  /\?|\b(go ahead|take your time|whenever you'?re ready|i'?m listening|let me know|tell me (more|about|what|where|when|how))\b|\b(can|could|would|will) you\b|(^|[.!]\s*)(please )?(spell|tell|give|say|repeat|confirm|describe)\b|\bplease (spell|tell|give|say|repeat|confirm|describe)\b/i;

const CLOSING_LINE =
  /\b(bye|goodbye|good bye|take care|talk soon|have a (good|great|nice|wonderful) (day|night|one|evening|weekend)|thanks? (you )?for calling)\b/i;

export function isStalledReply(responseText: string): boolean {
  const text = responseText.trim();
  if (text.length === 0) {
    // An empty reply is a deliberate silence (a fragment or backchannel the
    // runtime is holding), not a stall.
    return false;
  }
  return !ASKS_OR_INVITES.test(text) && !CLOSING_LINE.test(text);
}

export const KEEP_CALL_MOVING_NOTE =
  "[System note: your reply only acknowledged and did not move the call forward, so the caller " +
  "is now waiting in silence. Do not repeat or re-confirm what you just said, and do not ask again " +
  "for anything the caller already gave you. In one short sentence, ask the next thing you need. " +
  "If you already have everything, ask whether there is anything else you can help with.]";
