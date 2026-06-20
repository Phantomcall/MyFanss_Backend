# Password Reset Flow with Secure Email Tokens

This pull request implements a secure token-based password reset flow. Users can request a password reset via email, receive a single-use time-limited token (stubbed in dev via console log), and reset their password. The endpoint never reveals whether an email exists in the system (no user enumeration).

## Proposed Changes

### 1. Entity & Migration (`PasswordResetToken`)

- **New entity** `PasswordResetToken` at `src/auth/entities/password-reset-token.entity.ts` with these fields:
  - `id` — UUID primary key (auto-generated)
  - `userId` — int, foreign key to `User` with `CASCADE` on delete
  - `tokenHash` — SHA-256 hash of the raw token, stored as varchar with a unique index
  - `expiresAt` — timestamp, indexed for efficient cleanup queries
  - `usedAt` — nullable timestamp, to track single-use
  - `createdAt` — auto-set on creation
- **Indexes**: composite index on `(userId, usedAt)`, unique index on `tokenHash`, index on `expiresAt`
- **Migration** at `src/migrations/1781988836473-password-reset-token.ts` creates the `password_reset_tokens` table with all constraints, foreign key, and indexes

### 2. REST Endpoints

#### `POST /auth/forgot-password`
- **Input**: `{ email: string }` — validated as proper email format
- **Behavior**: Always returns HTTP 200 with `{ message: "If an account exists with this email, you will receive a password reset link" }`
- **Logic**:
  - Looks up user by email; if not found, returns early (no token created)
  - Generates 32-byte cryptographically random token (64 hex chars)
  - SHA-256 hashes the token for storage (constant-time DB lookup on reset)
  - Saves `{ userId, tokenHash, expiresAt: now + 15min }` to DB
  - Logs the raw token to console in dev mode (stub email delivery)
- **Security**: No user enumeration — same response for existing and non-existing emails
- **Rate limiting**: Protected by `@AuthTier()` decorator which applies per-IP throttling

#### `POST /auth/reset-password`
- **Input**: `{ token: string, newPassword: string }` — password validated with `@MinLength(8)`
- **Behavior**:
  - **200** — `{ message: "Password has been reset successfully" }` on success
  - **400** — `{ message: "Invalid or expired reset token" }` if token not found, expired, or already used
  - **400** — `{ message: "Password must be at least 8 characters" }` for weak passwords
- **Logic**:
  - Hashes incoming token with SHA-256 and looks it up in DB
  - Validates token is not used (`usedAt === null`) and not expired (`expiresAt > now`)
  - Fetches the user associated with the token
  - Hashes new password with bcrypt (10 salt rounds) and updates user
  - Marks token as used (`usedAt: new Date()`)
  - Invalidates all active refresh sessions for the user via `invalidateSessionsOnPasswordChange()`

### 3. Backend Service Changes

#### `AuthService`
- **`forgotPassword(email)`**: Token generation, hashing, storage, and dev-mode logging
- **`resetPassword(token, newPassword)`**: Token validation, password update, token invalidation, session cleanup
- **`invalidateSessionsOnPasswordChange(userId)`**: Calls `tokenService.revokeAllUserTokens()` to invalidate all refresh tokens

#### `UsersService`
- **`findById(id)`**: Made public (was private) — returns `User | null`
- **`updatePassword(id, passwordHash)`**: New method — updates password in DB and invalidates related caches

### 4. DTOs with Validation

| DTO | Fields | Validation |
|-----|--------|------------|
| `ForgotPasswordDto` | `email` | `@IsEmail()`, `@IsNotEmpty()` |
| `ResetPasswordDto` | `token`, `newPassword` | `@IsString()`, `@IsNotEmpty()`, `@MinLength(8)` on password |
| `ForgotPasswordResponseDto` | `message` | — |
| `ResetPasswordResponseDto` | `message` | — |

### 5. Security Design

- **Token entropy**: 32 bytes = 256 bits of cryptographic randomness via `crypto.randomBytes()`
- **Storage**: Tokens stored as SHA-256 hashes only — raw token never persisted
- **Expiry**: 15-minute TTL enforced at DB query level
- **Single-use**: `usedAt` column prevents token replay attacks
- **No enumeration**: `forgotPassword` returns 200 regardless of email existence
- **Session invalidation**: All refresh tokens revoked on password change to prevent session hijacking
- **Rate limiting**: `@AuthTier()` on forgot-password prevents brute-force attempts

### 6. Dev-Mode Mailer Stub

In non-production environments, tokens are logged to the console for testing:

```
Password reset token for user@example.com: a1b2c3d4e5f6...
```

This allows manual testing of the full flow without an email provider configured.

### 7. Documentation (`docs/password-reset.md`)

Comprehensive documentation covering:
- Architecture overview with sequence flow
- API endpoint specs with request/response examples
- Entity definition and migration structure
- Security considerations (OWASP-aligned)
- Testing scenarios and acceptance criteria
- Development setup guide

### 8. Test Coverage (10 Tests in `password-reset.spec.ts`)

| # | Test | Expected |
|---|------|----------|
| 1 | Generates token, saves SHA-256 hash, logs to console when user exists | Token saved + console.log called |
| 2 | Returns early without saving token if email doesn't exist (no enumeration) | `save()` not called |
| 3 | Throws `BadRequestException` for password < 8 chars | 400 error |
| 4 | Throws `BadRequestException` if token not found in DB | 400 error |
| 5 | Throws `BadRequestException` if token already used | 400 error |
| 6 | Throws `BadRequestException` if token expired | 400 error |
| 7 | Throws `NotFoundException` if user not found for token | 404 error |
| 8 | Successfully resets password, hashes new pw, marks used, invalidates sessions | All side effects verified |
| 9 | Controller `forgotPassword` returns 200 with correct response | Correct message |
| 10 | Controller `resetPassword` returns 200 with success response | Correct message |

## Acceptance Criteria

- ✅ Valid token resets password, old password stops working
- ✅ Invalid/expired/used token returns 400
- ✅ Response never reveals whether email exists in system
- ✅ Tokens stored hashed only (SHA-256)
- ✅ Rate limit triggers 429 on abuse (via `@AuthTier()`)
- ✅ At least 8 tests — implemented 10
- ✅ All CI checks pass (format, test, build)

closes #23
