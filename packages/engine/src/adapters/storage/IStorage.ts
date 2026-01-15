export interface IStorage {
    read<T>(path: string): Promise<T | null>;
    write<T>(path: string, data: T): Promise<void>;
    delete(path: string): Promise<void>;
    list(dir: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    ensureDir(dirPath: string): Promise<void>;
}
