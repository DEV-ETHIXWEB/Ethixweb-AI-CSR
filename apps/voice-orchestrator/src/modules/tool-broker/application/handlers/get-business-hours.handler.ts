import { Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { GetBusinessHoursInput } from "../../domain/tool-catalog";

export interface GetBusinessHoursOutput {
  isOpen: boolean;
  opensAt?: string;
  isHoliday: boolean;
}

/**
 * docs/04 §3.6 `getBusinessHours`. No `emergency-rules`/business-hours
 * query module exists yet to check real `BusinessHour` rows against
 * (that's Phase 7, per the roadmap this build was scoped against) — this
 * handler applies docs/04 §3.6's OWN documented failure fallback
 * unconditionally: "falls back to a conservative 'treat as after-hours'
 * default on failure... never falsely tells a caller the office is open."
 * Not a guess; a literal transcription of the documented contract for
 * exactly the state this handler is always in today.
 */
@Injectable()
export class GetBusinessHoursHandler implements ToolHandler<
  GetBusinessHoursInput,
  GetBusinessHoursOutput
> {
  async execute(
    _input: GetBusinessHoursInput,
    _context: ToolHandlerContext,
  ): Promise<GetBusinessHoursOutput> {
    return { isOpen: false, isHoliday: false };
  }
}
