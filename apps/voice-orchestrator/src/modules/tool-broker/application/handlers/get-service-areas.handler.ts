import { Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { GetServiceAreasInput } from "../../domain/tool-catalog";

export interface GetServiceAreasOutput {
  inServiceArea: boolean;
}

/**
 * docs/04 §3.7 `getServiceAreas`. Unlike its siblings (§3.6/§3.8/§3.9),
 * this tool's own table has NO documented Timeout/Retries/failure-fallback
 * row to transcribe literally — a genuine gap in the docs, not something
 * to paper over with an invented rule. No service-area module exists yet
 * (same Phase 7 gap as getBusinessHours) to answer this for real, so a
 * default has to be picked. INFERRED, not verbatim: defaults to `true`
 * (assume in-area) rather than `false`, because a false "out of area"
 * actively turns away a real, servable customer — an unrecoverable harm
 * mid-call — whereas a false "in area" only risks one avoidable
 * qualification call, correctable by a human later. Revisit once this
 * tool has a real backing implementation.
 */
@Injectable()
export class GetServiceAreasHandler implements ToolHandler<
  GetServiceAreasInput,
  GetServiceAreasOutput
> {
  async execute(
    _input: GetServiceAreasInput,
    _context: ToolHandlerContext,
  ): Promise<GetServiceAreasOutput> {
    return { inServiceArea: true };
  }
}
