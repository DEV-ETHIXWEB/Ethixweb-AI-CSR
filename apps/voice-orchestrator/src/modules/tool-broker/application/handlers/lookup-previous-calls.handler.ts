import { Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { LookupPreviousCallsInput } from "../../domain/tool-catalog";

export interface LookupPreviousCallsOutput {
  calls: Array<{ call_id: string; date: string; summary: string; leadStatus: string }>;
}

/**
 * docs/04 §3.9 `lookupPreviousCalls`. No `calls` module exists yet (Phase
 * 10, per the roadmap) to query real call history from — this handler
 * applies docs/04 §3.9's own documented fallback verbatim: "on failure
 * returns empty list — degraded but never blocking (AI proceeds as if no
 * history, worst case re-asks a question)."
 */
@Injectable()
export class LookupPreviousCallsHandler implements ToolHandler<
  LookupPreviousCallsInput,
  LookupPreviousCallsOutput
> {
  async execute(
    _input: LookupPreviousCallsInput,
    _context: ToolHandlerContext,
  ): Promise<LookupPreviousCallsOutput> {
    return { calls: [] };
  }
}
