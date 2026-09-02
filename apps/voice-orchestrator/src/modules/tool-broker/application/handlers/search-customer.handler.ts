import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { SearchCustomerInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

interface CustomerResponse {
  id: string;
  name: string;
  address: Record<string, unknown> | null;
}

export interface SearchCustomerOutput {
  found: boolean;
  customer?: { id: string; name: string; address: Record<string, unknown> | null };
}

/** docs/04 §3.1 `searchCustomer` — delegates to customers module's ResolveCustomerUseCase via CustomersToolController, never touches a CRM adapter directly. */
@Injectable()
export class SearchCustomerHandler implements ToolHandler<
  SearchCustomerInput,
  SearchCustomerOutput
> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(
    input: SearchCustomerInput,
    context: ToolHandlerContext,
  ): Promise<SearchCustomerOutput> {
    const result = await this.coreApiClient.post<CustomerResponse | null>(
      "/internal/customers/resolve",
      {
        businessId: context.businessId,
        phoneE164: input.phone,
      },
    );
    if (!result) {
      return { found: false };
    }
    // docs/04 §3.1's output also lists `tags`/`lastServiceDate`/`openLeads`
    // — none of those fields exist anywhere in this codebase yet (no CRM
    // tag sync, no cross-reference to open leads from here); omitted
    // rather than fabricated, same "don't invent" discipline as everywhere
    // else in this build.
    return { found: true, customer: { id: result.id, name: result.name, address: result.address } };
  }
}
