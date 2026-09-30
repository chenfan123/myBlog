import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PersistentCacheRecord<TInput = unknown> = {
  key: string;
  input: TInput;
  expiresAt: number;
  payload: Record<string, unknown>;
};

export class PersistentCache {
  constructor(private readonly directory = process.env.A2UI_CACHE_DIR?.trim() || "") {}

  get enabled(): boolean {
    return Boolean(this.directory);
  }

  async get<TInput>(namespace: string, key: string): Promise<PersistentCacheRecord<TInput> | undefined> {
    if (!this.enabled) return undefined;
    try {
      const raw = await readFile(this.path(namespace, key), "utf8");
      return JSON.parse(raw) as PersistentCacheRecord<TInput>;
    } catch {
      return undefined;
    }
  }

  async set<TInput>(namespace: string, record: PersistentCacheRecord<TInput>): Promise<void> {
    if (!this.enabled) return;
    const folder = join(this.directory, namespace);
    await mkdir(folder, { recursive: true });
    const destination = this.path(namespace, record.key);
    const temporary = `${destination}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), "utf8");
    await rename(temporary, destination);
  }

  async list<TInput>(namespace: string): Promise<Array<PersistentCacheRecord<TInput>>> {
    if (!this.enabled) return [];
    const folder = join(this.directory, namespace);
    try {
      const files = await readdir(folder);
      const records = await Promise.all(
        files.filter((file) => file.endsWith(".json")).map(async (file) => {
          try {
            return JSON.parse(await readFile(join(folder, file), "utf8")) as PersistentCacheRecord<TInput>;
          } catch {
            return undefined;
          }
        }),
      );
      return records.filter((record): record is PersistentCacheRecord<TInput> => Boolean(record));
    } catch {
      return [];
    }
  }

  private path(namespace: string, key: string): string {
    const digest = createHash("sha256").update(key).digest("hex");
    return join(this.directory, namespace, `${digest}.json`);
  }
}
