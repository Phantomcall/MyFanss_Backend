import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AuthController } from './auth.controller';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const mockPasswordResetTokenRepository = () => ({
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockUsersService = () => ({
  findByEmail: jest.fn(),
  findById: jest.fn(),
  updatePassword: jest.fn(),
});

const mockTokenService = () => ({
  revokeAllUserTokens: jest.fn(),
});

const mockAuditService = () => ({
  log: jest.fn(),
});

describe('Password Reset Flow (Unit)', () => {
  let authService: AuthService;
  let authController: AuthController;
  let resetTokenRepo: any;
  let usersService: any;
  let tokenService: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(PasswordResetToken),
          useFactory: mockPasswordResetTokenRepository,
        },
        {
          provide: UsersService,
          useFactory: mockUsersService,
        },
        {
          provide: TokenService,
          useFactory: mockTokenService,
        },
        {
          provide: AuditService,
          useFactory: mockAuditService,
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    authController = module.get<AuthController>(AuthController);
    resetTokenRepo = module.get(getRepositoryToken(PasswordResetToken));
    usersService = module.get<UsersService>(UsersService);
    tokenService = module.get<TokenService>(TokenService);
  });

  describe('forgotPassword', () => {
    it('should generate a token, save its SHA-256 hash, and log it to the console when user exists', async () => {
      const email = 'existing@example.com';
      const mockUser = { id: 42, email, name: 'Test User' };
      usersService.findByEmail.mockResolvedValue(mockUser);
      resetTokenRepo.save.mockResolvedValue({});
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      await authService.forgotPassword(email);

      expect(usersService.findByEmail).toHaveBeenCalledWith(email);
      expect(resetTokenRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUser.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      );
      expect(consoleLogSpy).toHaveBeenCalled();
      consoleLogSpy.mockRestore();
    });

    it('should return early without generating or saving a token if the user does not exist (no user enumeration)', async () => {
      const email = 'nonexistent@example.com';
      usersService.findByEmail.mockResolvedValue(null);

      await authService.forgotPassword(email);

      expect(usersService.findByEmail).toHaveBeenCalledWith(email);
      expect(resetTokenRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should throw BadRequestException if newPassword is less than 8 characters', async () => {
      await expect(
        authService.resetPassword('some-token', 'short'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if token is not found in database', async () => {
      resetTokenRepo.findOne.mockResolvedValue(null);

      await expect(
        authService.resetPassword('some-token', 'validPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if token is already used', async () => {
      const mockToken = {
        id: 'token-uuid',
        userId: 42,
        tokenHash: 'somehash',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: new Date(),
      };
      resetTokenRepo.findOne.mockResolvedValue(mockToken);

      await expect(
        authService.resetPassword('some-token', 'validPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if token is expired', async () => {
      const mockToken = {
        id: 'token-uuid',
        userId: 42,
        tokenHash: 'somehash',
        expiresAt: new Date(Date.now() - 10 * 60 * 1000),
        usedAt: null,
      };
      resetTokenRepo.findOne.mockResolvedValue(mockToken);

      await expect(
        authService.resetPassword('some-token', 'validPassword123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if user associated with the token is not found', async () => {
      const mockToken = {
        id: 'token-uuid',
        userId: 42,
        tokenHash: 'somehash',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      };
      resetTokenRepo.findOne.mockResolvedValue(mockToken);
      usersService.findById.mockResolvedValue(null);

      await expect(
        authService.resetPassword('some-token', 'validPassword123'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reset password, hash the new password, mark token as used, and invalidate active sessions on success', async () => {
      const mockToken = {
        id: 'token-uuid',
        userId: 42,
        tokenHash: 'somehash',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      };
      const mockUser = { id: 42, email: 'user@example.com', name: 'Test' };
      resetTokenRepo.findOne.mockResolvedValue(mockToken);
      usersService.findById.mockResolvedValue(mockUser);
      usersService.updatePassword.mockResolvedValue(undefined);
      resetTokenRepo.update.mockResolvedValue({});
      tokenService.revokeAllUserTokens.mockResolvedValue(undefined);

      await authService.resetPassword('some-token', 'validPassword123');

      expect(usersService.updatePassword).toHaveBeenCalledWith(
        mockUser.id,
        expect.any(String),
      );
      const hashedPassword = usersService.updatePassword.mock.calls[0][1];
      const matches = await bcrypt.compare('validPassword123', hashedPassword);
      expect(matches).toBe(true);

      expect(resetTokenRepo.update).toHaveBeenCalledWith(mockToken.id, {
        usedAt: expect.any(Date),
      });
      expect(tokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        mockUser.id,
      );
    });
  });

  describe('AuthController', () => {
    it('forgotPassword should return 200 and custom response message', async () => {
      const email = 'user@example.com';
      const forgotPasswordDto = { email };
      const forgotPasswordSpy = jest
        .spyOn(authService, 'forgotPassword')
        .mockResolvedValue(undefined);

      const result = await authController.forgotPassword(forgotPasswordDto);

      expect(forgotPasswordSpy).toHaveBeenCalledWith(email);
      expect(result).toEqual({
        message:
          'If an account exists with this email, you will receive a password reset link',
      });
    });

    it('resetPassword should return 200 and success response message', async () => {
      const resetPasswordDto = {
        token: 'some-token',
        newPassword: 'validPassword123',
      };
      const resetPasswordSpy = jest
        .spyOn(authService, 'resetPassword')
        .mockResolvedValue(undefined);

      const result = await authController.resetPassword(resetPasswordDto);

      expect(resetPasswordSpy).toHaveBeenCalledWith(
        resetPasswordDto.token,
        resetPasswordDto.newPassword,
      );
      expect(result).toEqual({
        message: 'Password has been reset successfully',
      });
    });
  });
});
