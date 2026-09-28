import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/auth/decorators';
import { AuthPrincipal } from '../../common/auth/principal';
import { LoginDto, RegisterDto, SwitchOrganizationDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthPrincipal) {
    return this.auth.me(user.userId, user.organizationId);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('switch-organization')
  switch(@CurrentUser() user: AuthPrincipal, @Body() dto: SwitchOrganizationDto) {
    return this.auth.switchOrganization(user, dto.organizationId);
  }
}
