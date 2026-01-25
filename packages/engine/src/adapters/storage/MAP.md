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
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  readBinary(path: string): Promise<Buffer | null>;
  writeBinary(path: string, data: Buffer): Promise<void>;
}
```

## Usage

The Fraktag class receives an IStorage instance via constructor.
Storage path includes tenant prefix for multi-tenancy:
- Local: `./data/trees/...`
- Cloud: `s3://bucket/tenants/{userId}/trees/...`

## Migration Path

1. Extract existing fs operations from JsonStorage
2. Implement same interface for S3Storage
3. Update Fraktag constructor to accept IStorage
4. Factory selects implementation based on env
