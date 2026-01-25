# ui/src/lib/

Utility libraries and third-party integrations.

## Structure

```
paddle.ts                 # Paddle.js SDK wrapper
cognito.ts                # AWS Amplify / Cognito auth helpers
api.ts                    # Axios instance with auth interceptor
```

## paddle.ts

Paddle payment SDK integration:
- Initialize Paddle.js
- Open checkout overlay
- Handle success/cancel callbacks

## cognito.ts

Cognito authentication helpers:
- Configure Amplify with User Pool
- Sign in redirect
- Token refresh
- Sign out

## api.ts

Axios instance configured per deploy mode:
```typescript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
});

api.interceptors.request.use((config) => {
  if (deployMode === 'cloud') {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});
```
