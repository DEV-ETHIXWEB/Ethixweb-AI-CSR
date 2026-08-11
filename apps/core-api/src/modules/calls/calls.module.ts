import { Module } from "@nestjs/common";
import { EndCallUseCase } from "./application/end-call.use-case";
import { GetCallUseCase } from "./application/get-call.use-case";
import { ListCallsUseCase } from "./application/list-calls.use-case";
import { StartCallUseCase } from "./application/start-call.use-case";
import { CALL_REPOSITORY } from "./domain/ports/call-repository.port";
import { PrismaCallRepository } from "./infrastructure/prisma-call.repository";
import { CallsToolController } from "./interfaces/calls-tool.controller";

/**
 * The production-blocker fix (Lead.callId -> Call.id FK integrity),
 * scoped deliberately narrow: docs/13-implementation-backlog.md `calls`
 * module items 3-5 (Transcript/ToolCall persistence, recording upload, the
 * admin call-detail API) are NOT built here — this module exists only for
 * call identity, tenant/business ownership, lifecycle status, telephony
 * correlation, and the FK integrity Lead.callId requires. See
 * call.entity.ts's own comment for the explicit boundary statement.
 *
 * Exports StartCallUseCase/EndCallUseCase/GetCallUseCase/ListCallsUseCase
 * directly (not behind a port token), the same "future Voice AI module to
 * inject" pattern LeadsModule's own exports comment already established —
 * ListCallsUseCase specifically is also what the new dashboard module
 * (docs 27/28) composes for activeCallsCount/callsToday.
 */
@Module({
  controllers: [CallsToolController],
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
