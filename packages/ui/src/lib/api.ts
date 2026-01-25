/**
 * Axios API client with auth interceptor.
 * Automatically attaches Authorization header in cloud mode.
 */

import axios from 'axios';

const DEPLOY_MODE = import.meta.env.VITE_DEPLOY_MODE || 'local';
const API_URL = import.meta.env.VITE_API_URL || '';

// Token storage key (must match AuthProvider)
const TOKEN_KEY = 'fraktag_access_token';

// Create axios instance
export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor: Add auth header
api.interceptors.request.use(
    (config) => {
        // Only add auth header in cloud mode
        if (DEPLOY_MODE === 'cloud') {
            const token = localStorage.getItem(TOKEN_KEY);
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor: Handle auth errors
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        // Handle 401 Unauthorized
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            if (DEPLOY_MODE === 'cloud') {
                // Could trigger token refresh here
                // For now, just clear auth and redirect to login
                localStorage.removeItem(TOKEN_KEY);
                window.location.href = '/';
            }
        }

        return Promise.reject(error);
    }
);

// Export default for convenience
export default api;
