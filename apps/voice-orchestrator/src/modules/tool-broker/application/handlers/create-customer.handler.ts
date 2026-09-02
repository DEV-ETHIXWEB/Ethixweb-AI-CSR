import { Inject, Injectable } from "@nestjs/common";
import type { ToolHandler, ToolHandlerContext } from "../../domain/tool-definition";
import type { CreateCustomerInput } from "../../domain/tool-catalog";
import { CORE_API_CLIENT, type CoreApiClientPort } from "../../domain/ports/core-api-client.port";

interface CustomerResponse {
  id: string;
}

export interface CreateCustomerOutput {
  customer_id: string;
  created: boolean;
}

/** docs/04 §3.2 `createCustomer` — delegates to customers module's CreateCustomerUseCase via CustomersToolController, which already handles the race-safe local dedup docs/05 §4 describes. */
@Injectable()
export class CreateCustomerHandler implements ToolHandler<
  CreateCustomerInput,
  CreateCustomerOutput
> {
  constructor(@Inject(CORE_API_CLIENT) private readonly coreApiClient: CoreApiClientPort) {}

  async execute(
    input: CreateCustomerInput,
    context: ToolHandlerContext,
  ): Promise<CreateCustomerOutput> {
    const result = await this.coreApiClient.post<CustomerResponse>("/internal/customers", {
      businessId: context.businessId,
      name: `${input.name.first} ${input.name.last}`,
      phoneE164: input.phone,
      email: input.email,
      address: input.address,
    });
    // `created: false` (docs/04 §3.2's race-dedup signal) isn't
    // distinguishable from the CustomerResponseDto alone — the REST
    // response shape is identical either way. Always `true`: the
    // caller-visible effect (a valid customer_id exists) is the same in
    // both cases, and docs/04's own wording frames the boolean as
    // informational, not load-bearing for the AI's next step.
    return { customer_id: result.id, created: true };
  }
}
