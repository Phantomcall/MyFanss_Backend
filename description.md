# Password Reset Flow with Secure Email Tokens

## Overview
Implements a secure token-based password reset flow. Users can request a password reset via email, receive a single-use time-limited token (stubbed in dev via console log), and reset their password. The endpoint never reveals whether an email exists in the system (no user enumeration).

## Changes

### New Files
- `src/auth/entities/password-reset-token.entity.ts` — TypeORM entity with `id`, `userId`, `tokenHash`, `expiresAt`, `usedAt`, `createdAt`
- `src/auth/dto/forgot-password.dto.ts` — Validates email input
- `src/auth/dto/reset-password.dto.ts` — Validates token + new password (min 8 chars via `@MinLength`)
- `src/auth/dto/forgot-password-response.dto.ts` — Response DTOs for both endpoints
- `src/auth/password-reset.spec.ts` — 10 test cases covering all scenarios
- `src/migrations/1781988836473-password-reset-token.ts` — Migration creating `password_reset_tokens` table with indexes and FK
- `docs/password-reset.md` — Comprehensive documentation with sequence diagram

### Modified Files
- `src/auth/auth.service.ts` — Added `forgotPassword()` and `resetPassword()` methods
- `src/auth/auth.controller.ts` — Added `POST /auth/forgot-password` and `POST /auth/reset-password` endpoints
- `src/auth/auth.module.ts` — Registered `PasswordResetToken` entity with TypeORM
- `src/users/users.service.ts` — Made `findById()` public, added `updatePassword()` method
- `src/migrations/appDataSource.db.ts` — Added `PasswordResetToken` entity

### Security
- **Tokens**: 32-byte cryptographically random, SHA-256 hashed for constant-time DB lookup
- **Expiry**: 15-minute TTL
- **Single-use**: `usedAt` field prevents replay
- **No enumeration**: `forgotPassword` always returns 200
- **Session invalidation**: All refresh tokens revoked on password change via `invalidateSessionsOnPasswordChange()`
- **Rate limiting**: `@AuthTier()` decorator on forgot-password endpoint

### CI Fixes
- Fixed prettier formatting issues in all password-reset-related files (`auth.controller.ts`, `auth.service.ts`, DTOs, entity, test file)

### Test Coverage (10 tests)
1. ✅ Generates token and saves SHA-256 hash when user exists
2. ✅ Returns early without saving token if user does not exist (no enumeration)
3. ✅ Throws `BadRequestException` for short password (< 8 chars)
4. ✅ Throws `BadRequestException` if token not found
5. ✅ Throws `BadRequestException` if token already used
6. ✅ Throws `BadRequestException` if token expired
7. ✅ Throws `NotFoundException` if user not found for token
8. ✅ Successfully resets password, hashes new password, marks token used, invalidates sessions
9. ✅ Controller `forgotPassword` returns 200 with correct message
10. ✅ Controller `resetPassword` returns 200 with success message

closes #23
