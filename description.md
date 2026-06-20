# Notification Preferences API

This pull request implements the Notification Preferences API, enabling users to control their notification preferences independently. It includes the database schema, entity mappings, REST API endpoints, user signup hooks, comprehensive unit testing, and API documentation.

## Proposed Changes

### 1. Database Schema & Migration
- **Entity**: Created `NotificationPreference` (`notification_preferences` table) with the following fields:
  - `id`: Auto-generated primary key (identity).
  - `userId`: `int` linked to the `User` entity via a one-to-one relationship (`onDelete: 'CASCADE'`). Indexed for query performance.
  - `newSubscriber`: `boolean`, default `true`.
  - `postFromSubscribedCreator`: `boolean`, default `true`.
  - `securityAlerts`: `boolean`, default `true`.
  - `marketing`: `boolean`, default `false`.
  - `created_at` / `updated_at`: Timestamps.
- **Migration**: Added database migration script `1769050000000-CreateNotificationPreferences.ts` with correct defaults and constraints.

### 2. REST Endpoints (`/users/me/notification-preferences`)
- **GET**: Retrieves the authenticated user's notification preferences. If the preferences do not exist yet, they are automatically created with default values (lazy-creation).
- **PATCH**: Supports partial updates to the notification preferences. The endpoint identifies and rejects requests containing invalid keys with a `400 Bad Request` exception.
- Both endpoints are secured under `JwtAuthGuard` and utilize the `AuthenticatedRequest` context.

### 3. User Signup Integration Hook
- Hooks into `UsersService.createUser` to automatically create default notification preferences immediately upon successful signup.

### 4. Service Helper (`shouldNotify`)
- Implemented `NotificationsService.shouldNotify(userId, eventType)` for other system modules to query if they should deliver notifications for events like:
  - `newSubscriber`
  - `postFromSubscribedCreator`
  - `securityAlerts`
  - `marketing`
- Ensures invalid event types are rejected with a `BadRequestException`.

### 5. Code Quality & Testing
- Added comprehensive unit tests in `notifications.service.spec.ts` and `notifications.controller.spec.ts`.
- Cleaned up unused imports/variables and corrected TypeScript/ESLint warnings (e.g., resolving `unbound-method` errors and adding type assertions for mock requests/arguments).
- Formatted the codebase utilizing Prettier.

closes #29
