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

function annotateInterruptedResponse(conversation: Conversation): void {
  const lastMessage = conversation.messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content) {
    return;
  }
  if (lastMessage.content.includes(INTERRUPTION_NOTE)) {
    return;
  }
  lastMessage.content = `${lastMessage.content} ${INTERRUPTION_NOTE}`;
}
