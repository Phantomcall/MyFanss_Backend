import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { TokenService, TokenPair } from './token.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserRole } from './enums/role.enum';
import * as bcrypt from 'bcrypt';

export interface AuthResponse extends TokenPair {
  user: { id: number; name: string; email: string; role: UserRole };
  message?: string;
}

export interface AuthenticatedUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  async validateUser(
    email: string,
    pass: string,
  ): Promise<AuthenticatedUser | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && (await bcrypt.compare(pass, user.password))) {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: (user.role as UserRole) ?? UserRole.FAN,
      };
    }
    return null;
  }

  async signup(
    signupDto: SignupDto,
    opts: { deviceId?: string; userAgent?: string; ipAddress?: string } = {},
  ): Promise<AuthResponse> {
    const userResponse = await this.usersService.createUser(signupDto);
    const user = await this.usersService.findByEmail(signupDto.email);
    if (!user) throw new UnauthorizedException('User creation failed');

    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      user.email,
      (user.role as UserRole) ?? UserRole.FAN,
      opts,
    );
    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: (user.role as UserRole) ?? UserRole.FAN,
      },
      message: userResponse.message,
    };
  }

  async login(
    user: AuthenticatedUser,
    opts: { deviceId?: string; userAgent?: string; ipAddress?: string } = {},
  ): Promise<AuthResponse> {
    const tokens = await this.tokenService.issueTokenPair(
      user.id,
      user.email,
      user.role,
      opts,
    );
    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async refresh(
    rawRefreshToken: string,
    opts: { deviceId?: string; userAgent?: string; ipAddress?: string } = {},
  ): Promise<TokenPair> {
    return this.tokenService.rotateRefreshToken(rawRefreshToken, opts);
  }

  async logout(refreshToken: string): Promise<void> {
    const payload = this.tokenService.decodeRefreshToken(refreshToken);
    if (!payload) return;
    await this.tokenService.revokeToken(payload.tokenId);
  }

  async logoutAll(userId: number): Promise<void> {
    await this.tokenService.revokeAllUserTokens(userId);
  }

  async getSessions(userId: number): Promise<RefreshToken[]> {
    return this.tokenService.getActiveSessions(userId);
  }

  async deleteSession(sessionId: string, userId: number): Promise<boolean> {
    return this.tokenService.revokeSession(sessionId, userId);
  }

  async invalidateSessionsOnPasswordChange(userId: number): Promise<void> {
    await this.tokenService.revokeAllUserTokens(userId);
  }
}
