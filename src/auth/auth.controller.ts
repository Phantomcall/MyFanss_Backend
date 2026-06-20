import {
  Controller,
  Post,
  Body,
  UnauthorizedException,
  UseGuards,
  Get,
  Delete,
  Param,
  Req,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { AuthTier } from '../common/throttle/tiers.decorator';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

interface AuthenticatedRequest extends Request {
  user: {
    userId: number;
    email: string;
    username: string;
  };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post('signup')
  @AuthTier()
  @ApiOperation({
    summary: 'User signup — returns access + refresh token pair',
  })
  @ApiResponse({ status: 201, type: AuthTokensResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiBody({ type: SignupDto })
  async signup(@Body() signupDto: SignupDto, @Req() req: Request) {
    return this.authService.signup(signupDto, this.extractDeviceInfo(req));
  }

  @Post('login')
  @AuthTier()
  @HttpCode(200)
  @ApiOperation({ summary: 'User login — returns access + refresh token pair' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiBody({ type: LoginDto })
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      const ip =
        (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress;
      void this.auditService.log({
        actorId: null,
        action: AuditAction.USER_LOGIN_FAILED,
        targetType: 'User',
        targetId: null,
        metadata: { email: loginDto.email },
        ipAddress: ip,
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.authService.login(user, this.extractDeviceInfo(req));
  }

  @Post('refresh')
  @AuthTier()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate refresh token — returns new access + refresh token pair',
  })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({
    status: 401,
    description:
      'REFRESH_TOKEN_INVALID | REFRESH_TOKEN_REUSE_DETECTED | REFRESH_TOKEN_EXPIRED',
  })
  @ApiBody({ type: RefreshTokenDto })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(
      dto.refreshToken,
      this.extractDeviceInfo(req),
    );
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Logout current session — revokes current refresh token',
  })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  @ApiBody({ type: RefreshTokenDto })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { message: 'Logged out successfully' };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Logout all sessions — revokes all refresh tokens for user',
  })
  @ApiResponse({ status: 200, description: 'All sessions revoked' })
  async logoutAll(@Req() req: AuthenticatedRequest) {
    await this.authService.logoutAll(req.user.userId);
    return { message: 'All sessions revoked' };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List active sessions for current user' })
  @ApiResponse({ status: 200, type: [SessionResponseDto] })
  async getSessions(@Req() req: AuthenticatedRequest) {
    const sessions = await this.authService.getSessions(req.user.userId);
    return sessions.map(
      (s): SessionResponseDto => ({
        id: s.id,
        deviceId: s.deviceId,
        userAgent: s.userAgent,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      }),
    );
  }

  @Delete('sessions/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Revoke a specific session by ID' })
  @ApiResponse({ status: 200, description: 'Session revoked' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async deleteSession(
    @Param('id') sessionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const revoked = await this.authService.deleteSession(
      sessionId,
      req.user.userId,
    );
    if (!revoked) throw new NotFoundException('Session not found');
    return { message: 'Session revoked' };
  }

  private extractDeviceInfo(req: Request) {
    return {
      userAgent: req.headers['user-agent'] ?? undefined,
      ipAddress:
        (req.headers['x-forwarded-for'] as string) ||
        req.socket?.remoteAddress ||
        undefined,
      deviceId: (req.headers['x-device-id'] as string) ?? undefined,
    };
  }
}
