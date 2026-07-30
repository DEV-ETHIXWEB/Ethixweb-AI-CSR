import { Injectable } from "@nestjs/common";
import { StubCrmAdapter } from "./stub-crm-adapter.base";

/** docs/05-crm-integration.md §5 — OAuth2 client-credentials, separate CRM/Dispatch API modules. Not built in Phase 1; interface stub only. */
@Injectable()
export class ServiceTitanAdapter extends StubCrmAdapter {
  readonly crmType = "service_titan";
}
