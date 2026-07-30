import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenantContextService } from "./tenant-context.service";

@Global()
@Module({
  providers: [PrismaService, TenantContextService],
  exports: [PrismaService, TenantContextService],
})
export class PrismaModule {}
