import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AllowWithoutMfa, CurrentUser, Public } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { DisableTwoFactorDto, LoginDto, RegisterDto, SwitchOrganizationDto, TwoFactorCodeDto, TwoFactorLoginDto } from './auth.dto';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Second step after `login` answered `{ mfaRequired, mfaToken }`. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login/2fa')
  loginWithSecondFactor(@Body() dto: TwoFactorLoginDto) {
    return this.auth.loginWithSecondFactor(dto.mfaToken, dto.code);
  }

  @ApiBearerAuth()
  @AllowWithoutMfa()
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.me(user.userId, user.organizationId, user.amr);
  }

  /* ─────────── Two-factor authentication ─────────── */

  @ApiBearerAuth()
  @AllowWithoutMfa()
  @Get('2fa')
  twoFactorStatus(@CurrentUser() user: AuthPrincipal) {
    return this.twoFactor.status(user);
  }

  @ApiBearerAuth()
  @AllowWithoutMfa()
  @HttpCode(200)
  @Post('2fa/setup')
  twoFactorSetup(@CurrentUser() user: AuthPrincipal) {
    return this.twoFactor.setup(user);
  }

  @ApiBearerAuth()
  @AllowWithoutMfa()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/enable')
  twoFactorEnable(@CurrentUser() user: AuthPrincipal, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.enable(user, dto.code);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/disable')
  twoFactorDisable(@CurrentUser() user: AuthPrincipal, @Body() dto: DisableTwoFactorDto) {
    return this.twoFactor.disable(user, dto.password, dto.code);
  }

  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('2fa/recovery-codes')
  twoFactorRecoveryCodes(@CurrentUser() user: AuthPrincipal, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.regenerateRecoveryCodes(user, dto.code);
  }

  @ApiBearerAuth()
  @AllowWithoutMfa()
  @HttpCode(200)
  @Post('switch-organization')
  switch(@CurrentUser() user: AuthPrincipal, @Body() dto: SwitchOrganizationDto) {
    return this.auth.switchOrganization(user, dto.organizationId);
  }
}
