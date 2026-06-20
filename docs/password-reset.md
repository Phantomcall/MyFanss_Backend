# Password Reset Flow Implementation

## Overview
This implementation provides a secure token-based password reset flow for the My Fans Backend application. The system allows users to reset forgotten passwords securely using cryptographic tokens with expiration and rate limiting.

## Features

### 1. Password Reset Token Management
- Cryptographically secure random token generation (32 bytes, hex encoded)
- Hashed token storage using bcrypt with salt rounds = 10
- Token expiration: 15 minutes from creation
- Single-use tokens (tokens become invalid after use or when marked as used)
- Automatic cleanup of expired tokens

### 2. Endpoint Implementation

#### POST /auth/forgot-password
- **Purpose**: Request password reset instructions
- **Behavior**: Always returns HTTP 200, regardless of whether email exists
- **Input**: Email address (validated as email format)
- **Security**: No user enumeration - same response for existing and non-existing emails
- **Rate Limiting**: Applied per IP address and email to prevent abuse

#### POST /auth/reset-password
- **Purpose**: Reset password using valid reset token
- **Input**: Token and new password (password strength validation applied)
- **Response**: HTTP 200 on success, appropriate error codes for failures
- **Security**: Validates token existence, expiration, and single-use status

### 3. Security Measures

#### Token Security
- Tokens are cryptographically random (32 bytes = 64 hex characters)
- Tokens are stored as hashes using bcrypt (salted)
- Never expose raw tokens in logs or responses
- Dev mode logs tokens for testing/staging environments

#### Rate Limiting
- Per-IP rate limiting for forgot-password endpoint
- Additional per-email rate limiting to prevent abuse
- Fails secure when rate limits are exceeded (HTTP 429)

#### Password Policy
- Minimum 8 characters required
- Enforced at DTO level with custom validation messages

### 4. Integration Points

#### User Session Management
- Invalidates all refresh sessions when password is changed
- Calls `invalidateSessionsOnPasswordChange()` in AuthService
- Prevents session hijacking after password reset

#### Database Schema
- New entity: `PasswordResetToken`
- Table: `password_reset_tokens`
- Fields: id, userId, tokenHash, expiresAt, usedAt, createdAt
- Indexes on userId+usedAt, tokenHash (unique), and expiresAt

### 5. Development and Testing

#### Development Mode
- Tokens logged to console when `NODE_ENV` is not `production`
- Facilitates testing and development workflow

#### Testing Strategy
- Comprehensive test suite covering all scenarios
- Expired token handling
- Reused token detection
- Invalid email flow validation
- Rate limiting verification

## API Documentation

### POST /auth/forgot-password

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Responses:**
- **200**: {"message": "If an account exists with this email, you will receive a password reset link"}
- **429**: Rate limit exceeded (if applicable)

**Security Notes:**
- Always returns 200, regardless of email existence
- No information leakage about registered users
- Rate-limited per IP and email

### POST /auth/reset-password

**Request Body:**
```json
{
  "token": "a1b2c3d4e5f6...",
  "newPassword": "NewSecurePassword123"
}
```

**Responses:**
- **200**: {"message": "Password has been reset successfully"}
- **400**: {"message": "Invalid or expired reset token"} or {"message": "Password must be at least 8 characters long"}
- **404**: {"message": "Invalid or expired reset token"}

**Security Notes:**
- Token validation includes expiration check and single-use verification
- Old password is completely replaced
- All user sessions invalidated after password change

## Entity Definition

### PasswordResetToken

```typescript
@Entity('password_reset_tokens')
@Index(['userId', 'usedAt'])
@Index(['tokenHash'], { unique: true })
@Index(['expiresAt'])
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'varchar' })
  tokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
```

## Migration

A migration script is generated to create the `password_reset_tokens` table with appropriate indexes and foreign key constraints.

## Service Methods

### AuthService.forgotPassword(email: string)
- Finds user by email (does nothing if not found)
- Generates cryptographically secure token
- Hashes token and stores with expiration
- Logs token in dev mode (stub email delivery)
- No exceptions thrown for missing users

### AuthService.resetPassword(token: string, newPassword: string)
- Validates password length (minimum 8 characters)
- Finds token by hashing input token and matching against stored hash
- Validates token is not expired and not already used
- Fetches user by token's userId
- Updates user password with hashed version
- Marks token as used
- Invalidates all user sessions via `invalidateSessionsOnPasswordChange()`
- Raises appropriate exceptions for validation failures

## DTOs

### ForgotPasswordDto
- Validates email format
- No uniqueness validation (email may not exist)

### ResetPasswordDto
- Validates token format (string)
- Validates newPassword (string, minimum 8 characters)

## Testing

### Test Scenarios

1. **Expired Token Test**
   - Create token, set it to expired
   - Attempt reset with expired token
   - Expect 400 response with expired token message

2. **Reused Token Test**
   - Create valid token
   - Use token for successful reset
   - Attempt reset with same token
   - Expect 400 response (token already used)

3. **Invalid Email Flow Test**
   - Request password reset for non-existent email
   - Expect 200 response (no user enumeration)
   - Verify no tokens were created

4. **Rate Limiting Test**
   - Make multiple requests from same IP
   - Exceed rate limit
   - Expect 429 response

5. **Password Complexity Test**
   - Attempt reset with short password (less than 8 chars)
   - Expect 400 response with validation error

## Acceptance Criteria

✅ Valid token resets password
✅ Invalid/expired/used token returns 400 (or 404)
✅ Response never reveals whether email exists in system
✅ Old password no longer works after reset
✅ Tokens stored hashed only
✅ Rate limit triggers 429 on abuse
✅ At least 8 tests covering all scenarios
✅ Proper error handling and validation
✅ Dev-mode mailer stub working (console logging)

## Development Setup

### Prerequisites
- Node.js v20.x
- PostgreSQL database
- Redis (for rate limiting if using cache-based implementation)

### Running Tests
```bash
npm test
```

### Running Migration
```bash
npm run typeorm migration:run
```

## Security Considerations

1. **No User Enumeration**: Always return same success message for existing and non-existing emails
2. **Token Security**: Use cryptographically secure random tokens, store as hashes
3. **Token Expiration**: 15-minute window prevents long-term token validity
4. **Single-Use**: Tokens become invalid after use
5. **Rate Limiting**: Prevents brute force attacks
6. **Password Policy**: Enforce minimum password strength
7. **Session Invalidation**: Prevents session hijacking after password change
8. **Input Validation**: All inputs properly validated and sanitized

## Future Enhancements

1. **Email Integration**: Replace console logging with actual email service
2. **Token Blacklisting**: Consider token blacklisting for additional security
3. **Custom Expiration**: Make token expiration time configurable
4. **Password History**: Prevent password reuse (store last N passwords)
5. **Multi-Factor Authentication**: Consider adding MFA for password reset

## References

- NestJS Documentation
- TypeORM Documentation
- bcrypt.js Documentation
- Node.js Crypto Module
- OWASP Password Reset Guidelines

closes #23
