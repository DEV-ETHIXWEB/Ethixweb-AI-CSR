import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../shared/observability/tracing";
import { AssembleSystemPromptUseCase } from "../../prompt/application/assemble-system-prompt.use-case";
import type { RuntimeContext } from "../../prompt/domain/runtime-context";
import { EVENT_BUS, type EventBusPort } from "../../events/domain/orchestrator-event";
import type { Conversation } from "../domain/conversation.entity";
import {
  CONVERSATION_REPOSITORY,
  type ConversationRepository,
} from "../domain/ports/conversation-repository.port";

export interface StartConversationCommand {
  tenantId: string;
  businessId: string;
  callId: string;
  callerAni: string;
  timezone?: string | undefined;
}

/**
 * Called by the Voice Runtime when a call connects — the point where
 * docs/03 §1's layered prompt is assembled ONCE for the whole call (not
 * per turn), which is what makes provider-side prompt caching effective
 * per docs/02 §3's latency budget.
 */
@Injectable()
export class StartConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly repository: ConversationRepository,
    private readonly assembleSystemPrompt: AssembleSystemPromptUseCase,
    @Inject(EVENT_BUS) private readonly eventBus: EventBusPort,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: StartConversationCommand): Promise<Conversation> {
    setSpanAttributes({
      "ethixweb.tenant_id": command.tenantId,
      "ethixweb.business_id": command.businessId,
    });

    const runtimeContext: RuntimeContext = {
      currentTimeIso: new Date().toISOString(),
      timezone: command.timezone ?? "UTC",
      // Populated by the getBusinessHours/searchCustomer tools once the
      // conversation is under way — honestly `null` here rather than a
      // guessed default, see formatRuntimeContext's own handling.
      businessHours: null,
      callerAni: command.callerAni,
      existingCustomerMatch: null,
    };

    const { systemPrompt, profile } = await this.assembleSystemPrompt.execute(
      command.tenantId,
      command.businessId,
      runtimeContext,
    );

    const now = new Date().toISOString();
    const conversation = await this.repository.create({
      id: randomUUID(),
      tenantId: command.tenantId,
      businessId: command.businessId,
      callId: command.callId,
      state: "greeting",
      systemPrompt,
      llmModel: profile.llmModel,
      messages: [],
      transcript: [],
      leadId: null,
      startedAt: now,
      endedAt: null,
      endReason: null,
    });

    await this.eventBus.publish({
      type: "conversation.started",
      tenantId: conversation.tenantId,
      businessId: conversation.businessId,
      conversationId: conversation.id,
      callId: conversation.callId,
      at: now,
    });
    this.logger.info("conversation started", {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
    });

    return conversation;
  }
}
