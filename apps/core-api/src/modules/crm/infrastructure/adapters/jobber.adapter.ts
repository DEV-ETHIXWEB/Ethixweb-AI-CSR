import { Injectable } from "@nestjs/common";
import { StubCrmAdapter } from "./stub-crm-adapter.base";

/** docs/05-crm-integration.md §5 — GraphQL API, not REST. Not built in Phase 1; interface stub only. */
@Injectable()
export class JobberAdapter extends StubCrmAdapter {
  readonly crmType = "jobber";
}
