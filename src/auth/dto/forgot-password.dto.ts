import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({
    example: 'user@example.com',
    description:
      'User email address - always returns 200 regardless of existence',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
