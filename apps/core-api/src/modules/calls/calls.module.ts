import { Module } from "@nestjs/common";
import { EndCallUseCase } from "./application/end-call.use-case";
import { GetCallUseCase } from "./application/get-call.use-case";
import { ListCallsUseCase } from "./application/list-calls.use-case";
import { StartCallUseCase } from "./application/start-call.use-case";
import { CALL_REPOSITORY } from "./domain/ports/call-repository.port";
import { PrismaCallRepository } from "./infrastructure/prisma-call.repository";
import { CallsController } from "./interfaces/calls.controller";
import { CallsToolController } from "./interfaces/calls-tool.controller";

/**
 * The production-blocker fix (Lead.callId -> Call.id FK integrity),
 * scoped deliberately narrow: docs/13-implementation-backlog.md `calls`
 * module items 3-4 (Transcript/ToolCall persistence, recording upload) are
 * NOT built here — this module exists only for call identity,
 * tenant/business ownership, lifecycle status, telephony correlation, and
 * the FK integrity Lead.callId requires. See call.entity.ts's own comment
 * for the explicit boundary statement. Item 5, the admin call-detail API,
 * IS now built (`CallsController`, added for the dashboard's Live Calls
 * page) — list/get only, over the same narrow Call entity; still no
 * transcript/recording data to serve, because none is persisted.
 *
 * Exports StartCallUseCase/EndCallUseCase/GetCallUseCase/ListCallsUseCase
 * directly (not behind a port token), the same "future Voice AI module to
 * inject" pattern LeadsModule's own exports comment already established —
 * ListCallsUseCase specifically is also what the dashboard module (docs
 * 27/28) composes for activeCallsCount/callsToday.
 */
@Module({
  controllers: [CallsController, CallsToolController],
  providers: [
    { provide: CALL_REPOSITORY, useClass: PrismaCallRepository },
    StartCallUseCase,
    EndCallUseCase,
    GetCallUseCase,
    ListCallsUseCase,
  ],
  exports: [StartCallUseCase, EndCallUseCase, GetCallUseCase, ListCallsUseCase],
})
export class CallsModule {}
