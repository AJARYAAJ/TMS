import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiException } from '../http/api-exception';
import { ALLOW_WITHOUT_MFA, IS_PUBLIC, MIN_ROLE } from './decorators';
import { AuthPrincipal } from './principal';
import { hasRole, Role } from './roles';
import { TokenService } from './token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const principal = await this.tokens.authenticate(token);
    if (!principal) throw ApiException.unauthorized();
    if (principal.mfaSetupRequired && !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, [ctx.getHandler(), ctx.getClass()])) {
      throw new ApiException(403, 'MFA_SETUP_REQUIRED', 'Your workspace requires two-factor authentication. Turn it on to continue.');
    }
    req.user = principal;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<Role>(MIN_ROLE, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const user: AuthPrincipal | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !hasRole(user.role, required)) {
      throw ApiException.forbidden(`This action requires the ${required} role or higher`);
    }
    return true;
  }
}

/** Rate-limits per authenticated user, falling back to client IP for anonymous routes. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.userId ? `user:${req.user.userId}` : `ip:${req.ip}`;
  }
}
