import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordResponseDto {
  @ApiProperty({
    example:
      'If an account exists with this email, you will receive a password reset link',
    description:
      'Response message explaining that reset instructions were sent',
  })
  message: string;
}

export class ResetPasswordResponseDto {
  @ApiProperty({
    example: 'Password has been reset successfully',
    description: 'Confirmation message for successful password reset',
  })
  message: string;
}
