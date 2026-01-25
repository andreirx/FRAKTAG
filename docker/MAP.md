# docker/

Enterprise deployment packaging using Docker containers.

## Structure

```
Dockerfile.api            # API server container (Node.js)
Dockerfile.ui             # UI container (Nginx serving static build)
docker-compose.yml        # Local simulation / Enterprise deployment
docker-compose.enterprise.yml  # Production enterprise config
```

## Deployment Modes

### Local Development
```bash
docker-compose up
```
- Runs API + UI + optional MinIO for S3-compatible storage
- `FRAKTAG_DEPLOY_MODE=local`

### Enterprise (VPN)
```bash
docker-compose -f docker-compose.enterprise.yml up
```
- `FRAKTAG_DEPLOY_MODE=enterprise`
- No Cognito/AWS dependencies
- Storage: EFS/NFS mount OR MinIO/Private S3
- Auth: None (VPN-trusted) OR OIDC/SSO

## Environment Variables

### API Container
- `FRAKTAG_DEPLOY_MODE` - local | cloud | enterprise
- `STORAGE_ADAPTER` - fs | s3
- `STORAGE_ROOT` - ./data | s3://bucket/path
- `OPENAI_API_KEY` - Direct or from secrets

### UI Container
- `VITE_DEPLOY_MODE` - local | cloud | enterprise
- `VITE_API_URL` - Backend API URL
