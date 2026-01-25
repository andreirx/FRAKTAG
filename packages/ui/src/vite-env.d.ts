/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DEPLOY_MODE: 'local' | 'cloud' | 'enterprise';
    readonly VITE_API_URL: string;
    readonly VITE_COGNITO_DOMAIN: string;
    readonly VITE_COGNITO_CLIENT_ID: string;
    readonly VITE_COGNITO_REDIRECT_URI: string;
    readonly VITE_PADDLE_CLIENT_TOKEN: string;
    readonly VITE_PADDLE_ENVIRONMENT: 'production' | 'sandbox';
    readonly VITE_PADDLE_PRICE_PRO_MONTHLY: string;
    readonly VITE_PADDLE_PRICE_PRO_YEARLY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
