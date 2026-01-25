# ui/src/components/auth/

Authentication components for multi-mode deployment.

## Structure

```
AuthProvider.tsx          # React context for user state and tokens
AuthGuard.tsx             # Conditional render based on auth state
LoginScreen.tsx           # Cognito Hosted UI / Google OAuth
UserMenu.tsx              # User dropdown (logout, profile)
```

## AuthProvider.tsx

Context providing:
```typescript
interface AuthContext {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;      // Redirect to Cognito
  logout: () => void;
  accessToken: string | null;
}
```

## AuthGuard.tsx

Behavior based on `VITE_DEPLOY_MODE`:

| Mode       | Behavior                                    |
|------------|---------------------------------------------|
| local      | Always renders children (no auth)           |
| cloud      | Shows LoginScreen if not authenticated      |
| enterprise | Configurable (passthrough or SSO redirect)  |

## LoginScreen.tsx

- Cloud mode: "Sign in with Google" button
- Redirects to Cognito Hosted UI
- Handles OAuth callback, stores tokens

## Integration

```tsx
// App.tsx
<AuthProvider>
  <AuthGuard>
    <Router>
      <Routes>...</Routes>
    </Router>
  </AuthGuard>
</AuthProvider>
```
