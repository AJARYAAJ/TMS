import { IsEmail, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(200) password: string;
  @IsString() @MinLength(1) @MaxLength(120) organizationName: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
  @IsOptional() @IsUUID() organizationId?: string;
}

export class SwitchOrganizationDto {
  @IsUUID() organizationId: string;
}

export class TwoFactorLoginDto {
  @IsString() mfaToken: string;
  /** A 6-digit authenticator code or a recovery code (xxxx-xxxx). */
  @IsString() @MaxLength(20) code: string;
}

export class TwoFactorCodeDto {
  @IsString() @Matches(/^\d{3}\s?\d{3}$/, { message: 'Enter the 6-digit code from your authenticator app' }) code: string;
}

export class DisableTwoFactorDto {
  @IsString() password: string;
  @IsString() @MaxLength(20) code: string;
}
