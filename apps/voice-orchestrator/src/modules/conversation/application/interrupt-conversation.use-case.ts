import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import type { Conversation } from "../domain/conversation.entity";
import { assertValidConversationTransition } from "../domain/conversation-state";
import {
  ConversationAlreadyEndedError,
  ConversationNotFoundError,
  ConversationSaveConflictError,
} from "../domain/errors";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

/**
 * A short, model-visible note appended to an interrupted assistant
 * message — not shown to the caller, not touching the durable
 * `transcript` record (that stays exactly what was generated, for
 * accurate call review), only the working `messages` history the model
 * itself reads back on the next turn. `includes` check below makes a
 * retried /interrupt call (network retry, not a real second barge-in on
 * the same utterance) idempotent rather than stacking the note twice.
 */
const INTERRUPTION_NOTE =
  "[the caller interrupted before you finished saying this — don't assume they heard all of it]";

/**
 * docs/03 §6's barge-in row, the correctness half `TransitionConversationStateUseCase`
 * alone never covered: found live, not hypothetical, tracing the exact
 * conditions under which `CallSessionOrchestrator.handleBargeIn` calls
 * `POST /interrupt` at all — ONLY when TTS was actively playing an
 * already-fully-generated response (`this.ttsPlaying`), never while a
 * turn's own LLM completion was still in flight (that path aborts the
 * completion directly via `activeTurnAbort`, which already truncates
 * `responseText` to only what was actually generated before the signal
 * fired — see HandleTurnUseCase.streamOneCompletion's own abort check).
 * That means by the time this class ever runs, `runTurn` has ALREADY
 * durably saved the FULL intended response into `conversation.messages`
 * as if the caller heard every word of it — before Voice Runtime ever
 * started speaking it, let alone before the caller cut it off partway
 * through. The model's own memory of "what I just said" was silently
 * wrong on every barge-in that happens mid-playback (the common case —
 * a caller interrupting mid-generation is comparatively rare), a real,
 * previously-unfixed cause of the model referencing information "I
 * already told you" that the caller never actually heard.
 *
 * Deliberately does NOT try to truncate the message to the exact words
 * spoken — this service has no reliable byte-to-text alignment for
 * ElevenLabs' streamed audio (see CallSessionOrchestrator.speak's own
 * chunk-forwarding, which has no sentence/word boundary tracking to
 * truncate against), and guessing a cut point wrong is worse than not
 * cutting at all: an annotated FULL response the model knows to treat
 * as possibly-unheard is safer than a guessed-wrong partial one. The
 * model already handles an analogous honest-uncertainty signal correctly
 * (annotateLowConfidenceTranscript's "may be misheard" note) — this is
 * the same pattern applied to the AI's own output instead of the
 * caller's.
 *
 * A standalone read-mutate-save-retry-once cycle (not composed on top of
 * TransitionConversationStateUseCase) specifically to keep the state
 * transition and the message annotation in the SAME atomic write — two
 * separate saves would open a real, if narrow, lost-race window between
 * them for no benefit, and this codebase's own established convention
 * (StartConversationUseCase, HandleTurnUseCase.saveTurnResult,
 * TransitionConversationStateUseCase, EndConversationUseCase) is already
 * "each use case owns its own read-mutate-save-retry-once cycle," not a
 * shared helper — a fourth instance of that same pattern is consistent
 * with existing precedent, not a new one.
 */
@Injectable()
export class InterruptConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
  ) {}

  async execute(tenantId: string, conversationId: string): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": tenantId,
      "ethixweb.conversation_id": conversationId,
    });

    const conversation = await this.repository.findById(tenantId, conversationId);
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (conversation.endedAt) {
      throw new ConversationAlreadyEndedError(conversationId);
    }

    assertValidConversationTransition(conversation.state, "silence");
    conversation.state = "silence";
    annotateInterruptedResponse(conversation);

    const saved = await this.repository.save(conversation);
    if (saved) {
      return saved;
    }
    return this.resolveLostRace(tenantId, conversationId);
  }

  /** Single retry on the freshly-read version — same one-re-read discipline as this module's other CAS callers, not a loop. */
  private async resolveLostRace(tenantId: string, conversationId: string): Promise<Conversation> {
    const fresh = await this.repository.findById(tenantId, conversationId);
    if (!fresh) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (fresh.endedAt) {
      throw new ConversationAlreadyEndedError(conversationId);
    }
    assertValidConversationTransition(fresh.state, "silence");
    fresh.state = "silence";
    annotateInterruptedResponse(fresh);
    const saved = await this.repository.save(fresh);
    if (!saved) {
      throw new ConversationSaveConflictError(conversationId);
    }
    return saved;
  }
}

/**
 * Annotates the last thing Grace actually SAID this turn, which is not
 * always the last message.
 *
 * Found 2026-10-22, by the two e2e tests that had been failing: this used to
 * look only at `messages.at(-1)`, and since the searchCustomer and
 * escalateEmergency backstops were added, a turn very often ends with a
 * `role: "tool"` message instead -- the backstop's own tool_use/tool_result
 * pair lands after the spoken text. So on the common case this whole class
 * exists for, the note was never applied at all, and the model went on
 * believing the caller heard a response they had cut off. The bug it was
 * written to prevent, silently switched off by a later change.
 *
 * Scans back past tool results and empty tool-call turns to the last
 * assistant message with words in it, and stops at a user message: past
 * that point a new caller turn has already begun, and whatever Grace said
 * before it is not what is being interrupted now.
 */
function annotateInterruptedResponse(conversation: Conversation): void {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]!;
    if (message.role === "user") {
      return;
    }
    if (message.role !== "assistant" || !message.content) {
      continue;
    }
    if (!message.content.includes(INTERRUPTION_NOTE)) {
      message.content = `${message.content} ${INTERRUPTION_NOTE}`;
    }
    return;
  }
}
