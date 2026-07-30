import { Inject, Injectable } from "@nestjs/common";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { UserNotFoundError } from "../../domain/errors";
import { USER_REPOSITORY, type UserRepository } from "../../domain/ports/user-repository.port";
import type { PublicUser } from "../../domain/user.entity";
import { toPublicUser } from "../../domain/user.entity";

@Injectable()
export class GetCurrentUserUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
  ) {}

  async execute(tenantId: string, userId: string): Promise<PublicUser> {
    setSpanAttributes({ "ethixweb.tenant_id": tenantId, "ethixweb.user_id": userId });

    const user = await this.tenantContext.run(tenantId, (db) =>
      this.userRepository.findById(db, tenantId, userId),
    );
    if (!user) {
      throw new UserNotFoundError(userId);
    }
    return toPublicUser(user);
  }
}
