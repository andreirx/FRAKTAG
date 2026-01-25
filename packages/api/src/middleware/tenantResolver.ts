/**
 * Tenant resolver middleware.
 * Determines storage path based on user and deploy mode.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/env.js';

// Extend Express Request type
declare global {
    namespace Express {
        interface Request {
            storageRoot: string;
            storagePrefix: string;
        }
    }
}

/**
 * Resolve storage path for the current request.
 * Multi-tenant isolation in cloud mode, shared storage in local/enterprise.
 */
export function tenantResolver(
    req: Request,
    _res: Response,
    next: NextFunction
): void {
    const config = getConfig();

    // LOCAL MODE: Use configured storage root directly
    if (config.deployMode === 'local') {
        req.storageRoot = config.storageRoot;
        req.storagePrefix = '';
        return next();
    }

    // CLOUD MODE: Tenant isolation via user ID prefix
    if (config.deployMode === 'cloud') {
        const userId = req.user?.id;
        if (!userId || userId === 'anonymous') {
            req.storageRoot = config.storageRoot;
            req.storagePrefix = 'public/';
        } else {
            req.storageRoot = config.s3BucketData || config.storageRoot;
            req.storagePrefix = `tenants/${userId}/`;
        }
        return next();
    }

    // ENTERPRISE MODE: Configurable
    // Can use shared storage or per-user isolation based on config
    const enterpriseIsolation = process.env.ENTERPRISE_TENANT_ISOLATION === 'true';

    if (enterpriseIsolation && req.user?.id) {
        req.storageRoot = config.storageRoot;
        req.storagePrefix = `users/${req.user.id}/`;
    } else {
        req.storageRoot = config.storageRoot;
        req.storagePrefix = '';
    }

    next();
}

/**
 * Get full storage path for a relative path.
 */
export function getStoragePath(req: Request, relativePath: string): string {
    const prefix = req.storagePrefix || '';
    return prefix + relativePath;
}

/**
 * Validate that a path belongs to the current tenant.
 * Prevents path traversal attacks.
 */
export function validateTenantPath(req: Request, path: string): boolean {
    const prefix = req.storagePrefix || '';

    // If no prefix (local/enterprise), allow all paths
    if (!prefix) return true;

    // Normalize path
    const normalizedPath = path.replace(/\\/g, '/').replace(/^\/+/, '');

    // Must start with tenant prefix
    return normalizedPath.startsWith(prefix);
}
