import {
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
  ForbiddenException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { CreateUserDto } from './dtos/createUser.dto';
import { UserResponseDto } from './dtos/userResponse.dto';
import { plainToInstance } from 'class-transformer';
import { UpdateUserDto } from './dtos/updateUser.dto';
import { UpdateProfileDto } from './dtos/updateProfile.dto';
import { GetUsersQueryDto } from './dtos/get-users-query.dto';
import {
  PaginatedResponseDto,
  PaginationMetaDto,
} from './dtos/paginated-response.dto';
import { UsersQueryService } from './services/users-query.service';
import { SearchService } from './services/search.service';
import { PermissionService, JwtPayload } from './services/permission.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/audit-action.enum';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as bcrypt from 'bcrypt';
import { UserRole } from '../auth/enums/role.enum';
import { AppLogger } from '../logger/app-logger.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly queryService: UsersQueryService,
    private readonly searchService: SearchService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly logger: AppLogger,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getAllUsers(
    query: GetUsersQueryDto,
    requestingUser?: JwtPayload,
  ): Promise<PaginatedResponseDto<UserResponseDto>> {
    // Validate query parameters
    this.queryService.validateQueryParams(query);

    // Get permission-based org filter
    const orgFilter = requestingUser
      ? this.permissionService.getAccessibleOrgIds(requestingUser)
      : undefined;

    // Execute query with pagination, filtering, and sorting
    const result = await this.queryService.getUsers(query, orgFilter);

    // Apply row-level permission filtering
    const filteredUsers = requestingUser
      ? this.permissionService.filterByPermission(result.users, requestingUser)
      : result.users;

    // Transform to response DTOs
    const responseUsers = filteredUsers.map((user) =>
      plainToInstance(UserResponseDto, user, {
        excludeExtraneousValues: true,
      }),
    );

    // Build pagination metadata
    const paginationMeta: PaginationMetaDto = {
      cursor: result.nextCursor,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      limit: query.limit || 20,
      appliedFilters: this.getAppliedFilters(query),
    };

    return {
      data: responseUsers,
      pagination: paginationMeta,
    };
  }

  async createUser(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    const searchUser: User | null = await this.getUserByEmail(
      createUserDto.email,
    );

    if (searchUser) {
      throw new ConflictException('user already exists with this email');
    }

    // Hash the password before saving
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      saltRounds,
    );

    const user: User = plainToInstance(User, {
      ...createUserDto,
      password: hashedPassword,
    });
    const savedUser: User = await this.userRepository.save(user);

    // Update search text and invalidate caches
    await this.searchService.updateSearchTextForUser(savedUser.id);
    await this.invalidateUserRelatedCaches(savedUser.id);
    await this.notificationsService.createDefaultPreferences(savedUser.id);

    return plainToInstance(
      UserResponseDto,
      { message: 'user created successfully...', ...savedUser },
      {
        excludeExtraneousValues: true,
      },
    );
  }

  private getUserByEmail(email: string) {
    return this.userRepository.findOneBy({ email });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOneBy({ email });
  }

  async findById(id: number): Promise<User | null> {
    return this.userRepository.findOneBy({ id });
  }

  async updatePassword(id: number, passwordHash: string): Promise<void> {
    await this.userRepository.update(id, { password: passwordHash });
    await this.invalidateUserRelatedCaches(id);
  }

  async getUserById(id: number): Promise<UserResponseDto> {
    const user: User | null = await this.findById(id);
    if (!user) {
      throw new NotFoundException('user not found');
    }
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }

  async deleteUser(id: number, actorId?: number): Promise<string> {
    const user: User | null = await this.findById(id);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    // Soft delete
    await this.userRepository.update(id, { is_deleted: true });
    await this.invalidateUserRelatedCaches(id);

    void this.auditService.log({
      actorId: actorId ?? null,
      action: AuditAction.USER_DELETED,
      targetType: 'User',
      targetId: id,
      metadata: { email: user.email },
    });

    return 'user deleted successfully...';
  }

  async updateUser(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const user: User | null = await this.findById(id);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    const updatePayload = { ...updateUserDto };
    let passwordChanged = false;
    if (typeof updatePayload.password === 'string') {
      updatePayload.password = await bcrypt.hash(updatePayload.password, 10);
      passwordChanged = true;
    }

    Object.assign(user, updatePayload);
    const savedUser: User = await this.userRepository.save(user);

    if (passwordChanged) {
      await this.refreshTokenRepository.update(
        { userId: id, isRevoked: false },
        { isRevoked: true },
      );
    }

    // Update search text and invalidate caches
    await this.searchService.updateSearchTextForUser(savedUser.id);
    await this.invalidateUserRelatedCaches(savedUser.id);

    return plainToInstance(
      UserResponseDto,
      { message: 'user updated successfully', ...savedUser },
      {
        excludeExtraneousValues: true,
      },
    );
  }

  async changeUserRole(
    id: number,
    newRole: string,
    actorId: number,
  ): Promise<UserResponseDto> {
    const user: User | null = await this.findById(id);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    const oldRole = user.role;
    if (oldRole === newRole) {
      return plainToInstance(UserResponseDto, user, {
        excludeExtraneousValues: true,
      });
    }

    await this.userRepository.update(id, { role: newRole });
    user.role = newRole;

    void this.auditService.log({
      actorId,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'User',
      targetId: id,
      metadata: { before: oldRole, after: newRole },
    });

    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }

  async updateProfile(
    id: number,
    updateProfileDto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    const user: User | null = await this.findById(id);
    if (!user) {
      throw new NotFoundException('user not found');
    }

    Object.assign(user, updateProfileDto);
    const savedUser: User = await this.userRepository.save(user);

    await this.invalidateUserRelatedCaches(savedUser.id);

    return plainToInstance(UserResponseDto, savedUser, {
      excludeExtraneousValues: true,
    });
  }

  private async invalidateUserRelatedCaches(userId: number): Promise<void> {
    await this.cacheManager.del('users:totalCount');
    await this.cacheManager.del(`users:permissions:${userId}`);
    await this.cacheManager.del('users:search:*');
  }

  private getAppliedFilters(query: GetUsersQueryDto): Record<string, unknown> {
    const filters: Record<string, unknown> = {};

    if (query.search) filters.search = query.search;
    if (query.role) filters.role = query.role;
    if (query.status) filters.status = query.status;
    if (query.org_id) filters.org_id = query.org_id;
    if (query.created_from) filters.created_from = query.created_from;
    if (query.created_to) filters.created_to = query.created_to;

    return filters;
  }

  async updateUserRole(
    userId: number,
    role: UserRole,
    actorId?: number,
  ): Promise<User> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    const oldRole = user.role as UserRole;
    if (oldRole === role) {
      return user;
    }

    const updatedUser = await this.userRepository.save({
      ...user,
      role,
    });

    this.logger.log(
      `Role changed: actorId=${actorId ?? 'system'} targetId=${userId} oldRole=${oldRole} newRole=${role}`,
      UsersService.name,
    );

    await this.invalidateUserRelatedCaches(userId);

    return updatedUser;
  }

  async countAdmins(): Promise<number> {
    return this.userRepository.countBy({ role: UserRole.ADMIN });
  }
}
