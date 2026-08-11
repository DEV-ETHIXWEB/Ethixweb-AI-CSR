import { Module } from "@nestjs/common";
import { AiProviderModule } from "../ai-provider/ai-provider.module";
import { CapacityModule } from "../capacity/capacity.module";
import { PromptModule } from "../prompt/prompt.module";
import { ToolBrokerModule } from "../tool-broker/tool-broker.module";
import { EndConversationUseCase } from "./application/end-conversation.use-case";
import { GetConversationUseCase } from "./application/get-conversation.use-case";
import { HandleTurnUseCase } from "./application/handle-turn.use-case";
import { StartConversationUseCase } from "./application/start-conversation.use-case";
import { TransitionConversationStateUseCase } from "./application/transition-conversation-state.use-case";
import { CONVERSATION_REPOSITORY } from "./domain/ports/conversation-repository.port";
import { RedisConversationRepository } from "./infrastructure/redis-conversation.repository";
import { ConversationsController } from "./interfaces/conversations.controller";

@Module({
  imports: [AiProviderModule, PromptModule, ToolBrokerModule, CapacityModule],
  controllers: [ConversationsController],
  providers: [
    { provide: CONVERSATION_REPOSITORY, useClass: RedisConversationRepository },
    StartConversationUseCase,
    HandleTurnUseCase,
    EndConversationUseCase,
    GetConversationUseCase,
    TransitionConversationStateUseCase,
  ],
  exports: [StartConversationUseCase, HandleTurnUseCase, EndConversationUseCase],
})
export class ConversationModule {}
