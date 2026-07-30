import { Injectable } from "@nestjs/common";
import { StubCrmAdapter } from "./stub-crm-adapter.base";

/** docs/05-crm-integration.md §5 — REST API, sparsely documented publicly. Not built in Phase 1; interface stub only. */
@Injectable()
export class ServiceFusionAdapter extends StubCrmAdapter {
  readonly crmType = "service_fusion";
}
