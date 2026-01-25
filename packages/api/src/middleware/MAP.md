# api/src/middleware/

Request middleware for authentication and multi-tenancy.

## Structure

```
authMiddleware.ts         # JWT validation / mock user injection
tenantResolver.ts         # Determines storage path per user
index.ts                  # Middleware chain export
```

## authMiddleware.ts

Behavior based on `FRAKTAG_DEPLOY_MODE`:

| Mode       | Action                                           |
|------------|--------------------------------------------------|
| local      | Sets `req.user = { id: 'local-admin', plan: 'unlimited' }` |
| cloud      | Validates Cognito JWT, extracts `sub`, sets `req.user` |
| enterprise | Passthrough OR validates OIDC token if configured |

## tenantResolver.ts

Sets `req.storageRoot` based on mode:

| Mode       | Storage Root                              |
|------------|-------------------------------------------|
| local      | `./data`                                  |
| cloud      | `s3://bucket/tenants/${req.user.id}`      |
| enterprise | `process.env.STORAGE_ROOT` (configurable) |

## Request Extension

```typescript
declare global {
  namespace Express {
    interface Request {
      user: { id: string; email?: string; plan: string };
      storageRoot: string;
    }
  }
}
```
