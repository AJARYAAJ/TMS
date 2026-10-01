import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailModule } from '../email/email.module';
import { TwoFactorService } from './two-factor.service';

@Module({ imports: [EmailModule], controllers: [AuthController], providers: [AuthService, TwoFactorService], exports: [AuthService] })
export class AuthModule {}
