import { Injectable } from "@nestjs/common";
import { StubCrmAdapter } from "./stub-crm-adapter.base";

/** docs/05-crm-integration.md §5 — feasibility itself unconfirmed (limited public API docs). Not built in Phase 1; interface stub only. */
@Injectable()
export class FieldEdgeAdapter extends StubCrmAdapter {
  readonly crmType = "field_edge";
}
