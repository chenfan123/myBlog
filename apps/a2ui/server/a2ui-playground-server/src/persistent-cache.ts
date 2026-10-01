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
    await Promise.all([
      this.writeRecord(this.path(namespace, record.key), record),
      this.writeRecord(join(folder, "latest.json"), record),
    ]);
  }

  async latest<TInput>(namespace: string): Promise<PersistentCacheRecord<TInput> | undefined> {
    if (!this.enabled) return undefined;
    try {
      const raw = await readFile(join(this.directory, namespace, "latest.json"), "utf8");
      return JSON.parse(raw) as PersistentCacheRecord<TInput>;
    } catch {
      return undefined;
    }
  }

  async list<TInput>(namespace: string): Promise<Array<PersistentCacheRecord<TInput>>> {
    if (!this.enabled) return [];
    const folder = join(this.directory, namespace);
    try {
      const files = await readdir(folder);
      const records = await Promise.all(
        files.filter((file) => file.endsWith(".json") && file !== "latest.json").map(async (file) => {
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

  private async writeRecord<TInput>(destination: string, record: PersistentCacheRecord<TInput>): Promise<void> {
    const temporary = `${destination}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify(record), "utf8");
    await rename(temporary, destination);
  }
}
