import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../common/auth/roles';

export class CreateOrganizationDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
}

export class AddMemberDto {
  @IsEmail() email: string;
  @IsEnum(Role) role: Role;
  /** Required only when the email does not belong to an existing account. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

export class UpdateMemberDto {
  @IsEnum(Role) role: Role;
}
