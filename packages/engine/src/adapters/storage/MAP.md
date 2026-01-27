# engine/src/adapters/storage/

Storage abstraction layer for hexagonal architecture.

## Structure

```
IStorage.ts               # Storage interface contract
JsonStorage.ts            # Local filesystem implementation (existing, to migrate)
S3Storage.ts              # AWS S3 implementation for cloud/enterprise
index.ts                  # Factory: creates adapter based on STORAGE_ADAPTER env
```

## Interface: IStorage

```typescript
interface IStorage {
  read<T>(path: string): Promise<T | null>;
  write<T>(path: string, data: T): Promise<void>;
  delete(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  ensureDir(dirPath: string): Promise<void>;
  appendLine?(filePath: string, line: string): Promise<void>;
  getBasePath?(): string;
}
```

## Usage

The Fraktag class receives an IStorage instance via constructor.
Storage path includes tenant prefix for multi-tenancy:
- Local: `./data/trees/...`
- Cloud: `s3://bucket/tenants/{userId}/trees/...`

## Factory Function (`createStorage`)

```typescript
function createStorage(config?: Partial<StorageConfig>): IStorage;
// Reads STORAGE_ADAPTER env var ('fs' | 's3')
// For S3: requires S3_BUCKET_DATA, optional STORAGE_PREFIX
// For fs: uses STORAGE_ROOT or './data'
```
