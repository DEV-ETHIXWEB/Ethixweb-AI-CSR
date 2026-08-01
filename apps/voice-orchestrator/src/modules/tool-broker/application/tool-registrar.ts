import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { ToolHandler } from "../domain/tool-definition";
import { TOOL_CATALOG } from "../domain/tool-catalog";
import { CreateCustomerHandler } from "./handlers/create-customer.handler";
import { CreateLeadHandler } from "./handlers/create-lead.handler";
import { EscalateEmergencyHandler } from "./handlers/escalate-emergency.handler";
import { GetBusinessHoursHandler } from "./handlers/get-business-hours.handler";
import { GetServiceAreasHandler } from "./handlers/get-service-areas.handler";
import { LookupPreviousCallsHandler } from "./handlers/lookup-previous-calls.handler";
import { SearchCustomerHandler } from "./handlers/search-customer.handler";
import { UpdateLeadHandler } from "./handlers/update-lead.handler";
import { ToolRegistry } from "./tool-registry";

/** Binds every {@link TOOL_CATALOG} definition to its concrete handler at startup — a missing binding fails loudly (module init throws) rather than silently leaving a tool unreachable. */
@Injectable()
export class ToolRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly searchCustomer: SearchCustomerHandler,
    private readonly createCustomer: CreateCustomerHandler,
    private readonly createLead: CreateLeadHandler,
    private readonly updateLead: UpdateLeadHandler,
    private readonly getBusinessHours: GetBusinessHoursHandler,
    private readonly getServiceAreas: GetServiceAreasHandler,
    private readonly escalateEmergency: EscalateEmergencyHandler,
    private readonly lookupPreviousCalls: LookupPreviousCallsHandler,
  ) {}

  onModuleInit(): void {
    const handlersByName: Record<string, ToolHandler> = {
      searchCustomer: this.searchCustomer,
      createCustomer: this.createCustomer,
      createLead: this.createLead,
      updateLead: this.updateLead,
      getBusinessHours: this.getBusinessHours,
      getServiceAreas: this.getServiceAreas,
      escalateEmergency: this.escalateEmergency,
      lookupPreviousCalls: this.lookupPreviousCalls,
    };

    for (const definition of TOOL_CATALOG) {
      const handler = handlersByName[definition.name];
      if (!handler) {
        throw new Error(`ToolRegistrar: no handler bound for tool "${definition.name}"`);
      }
      this.registry.register(definition, handler);
    }
  }
}
