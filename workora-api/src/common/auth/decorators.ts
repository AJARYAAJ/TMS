import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthPrincipal } from './principal';
import { Role } from './roles';

export const IS_PUBLIC = 'workora:isPublic';
export const MIN_ROLE = 'workora:minRole';
export const ALLOW_WITHOUT_MFA = 'workora:allowWithoutMfa';

/** Skip authentication for this route. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Reachable while the workspace's 2FA requirement is still unmet (session info, 2FA setup, sign out). */
export const AllowWithoutMfa = () => SetMetadata(ALLOW_WITHOUT_MFA, true);

/** Require at least this role in the current organization (RBAC). */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthPrincipal => {
  return ctx.switchToHttp().getRequest().user;
});
