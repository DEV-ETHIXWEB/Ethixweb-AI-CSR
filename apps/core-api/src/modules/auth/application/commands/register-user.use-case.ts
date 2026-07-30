import { Inject, Injectable } from "@nestjs/common";
import type { UserRole } from "@ethixweb/database";
import type { StructuredLogger } from "@ethixweb/shared-kernel";
import { APP_LOGGER } from "../../../../shared/observability/app-logger.module";
import { setSpanAttributes } from "../../../../shared/observability/tracing";
import { TenantContextService } from "../../../../shared/prisma/tenant-context.service";
import { Email } from "../../domain/value-objects/email.vo";
import { PasswordHash } from "../../domain/value-objects/password-hash.vo";
import { EmailAlreadyRegisteredError } from "../../domain/errors";
import { assertCanAssignRole } from "../../domain/role-assignment-policy";
import { USER_REPOSITORY, type UserRepository } from "../../domain/ports/user-repository.port";
import type { PublicUser } from "../../domain/user.entity";
import { toPublicUser } from "../../domain/user.entity";

export interface RegisterUserCommand {
  tenantId: string;
  email: string;
  password: string;
  role: UserRole;
  /**
   * The role of the user *performing* this registration — required so
   * `assertCanAssignRole` can enforce that an `admin` cannot mint a new
   * `owner` (see that function's own comment for the vulnerability this
   * closes). `undefined` only for the not-yet-built platform-admin
   * bootstrap path (docs/13-implementation-backlog.md's seed-script task)
   * where no acting user exists yet — every real HTTP caller always
   * supplies this from their authenticated principal.
   */
  actingUserRole: UserRole | undefined;
}

/**
 * Creates a user within an existing tenant — the onboarding flow's first
 * owner account, or a later admin-invited teammate (docs/15-tenant-lifecycle-billing-and-analytics.md
 * §1). WHO is allowed to CALL this (an existing owner/admin, or the
 * unauthenticated onboarding flow for a brand-new tenant's very first
 * user) is an authorization decision made at the controller/guard layer;
 * WHAT ROLE that caller may GRANT is enforced here, via
 * `assertCanAssignRole` — those are two different questions, and
 * `@Roles()` alone only answers the first one.
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(APP_LOGGER) private readonly logger: StructuredLogger,
  ) {}

  async execute(command: RegisterUserCommand): Promise<PublicUser> {
    setSpanAttributes({ "ethixweb.tenant_id": command.tenantId });

    if (command.actingUserRole) {
      assertCanAssignRole(command.actingUserRole, command.role);
    }

    const email = Email.create(command.email);
    const passwordHash = await PasswordHash.hash(command.password);

    const user = await this.tenantContext.run(command.tenantId, async (db) => {
      const existing = await this.userRepository.findByEmail(
        db,
        command.tenantId,
        email.toString(),
      );
      if (existing) {
        throw new EmailAlreadyRegisteredError(email.toString());
      }
      return this.userRepository.create(db, {
        tenantId: command.tenantId,
        email: email.toString(),
        passwordHash: passwordHash.toStoredValue(),
        role: command.role,
      });
    });

    setSpanAttributes({ "ethixweb.user_id": user.id });
    this.logger.info("user registered", {
      tenantId: command.tenantId,
      userId: user.id,
      role: user.role,
    });

    return toPublicUser(user);
  }
}
