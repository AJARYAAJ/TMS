import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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
