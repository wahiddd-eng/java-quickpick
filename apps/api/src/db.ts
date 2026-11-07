import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Config } from './config.js';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const INT8 = 20;

/** BIGINT paise values fit comfortably in a JS safe integer, so parse them as numbers. */
pg.types.setTypeParser(INT8, (v: string) => Number(v));

export async function createDb(config: Pick<Config, 'databaseUrl' | 'pgliteDataDir'>, opts: { memory?: boolean } = {}): Promise<Db> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    return {
      async query<T>(sql: string, params?: unknown[]) {
        const r = await pool.query(sql, params as any[]);
        return r.rows as T[];
      },
      async tx<T>(fn: (q: Queryable) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            async query<R>(sql: string, params?: unknown[]) {
              return (await client.query(sql, params as any[])).rows as R[];
            },
          });
          await client.query('COMMIT');
          return result;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        } finally {
          client.release();
        }
      },
      async exec(sql: string) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }

  // Embedded PostgreSQL (WASM) for zero-install local development and tests.
  const dataDir = opts.memory ? undefined : path.resolve(config.pgliteDataDir);
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const lite = new PGlite(dataDir, { parsers: { [INT8]: (v: string) => Number(v) } });
  await lite.waitReady;
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await lite.query<T>(sql, params as any[])).rows;
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      return lite.transaction(async (t) =>
        fn({
          async query<R>(sql: string, params?: unknown[]) {
            return (await t.query<R>(sql, params as any[])).rows;
          },
        }),
      );
    },
    async exec(sql: string) {
      await lite.exec(sql);
    },
    async close() {
      await lite.close();
    },
  };
}

export async function migrate(db: Db): Promise<string[]> {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await db.tx(async (q) => {
      // Multi-statement DDL: run statements one by one inside the transaction.
      for (const stmt of splitSql(sql)) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
    });
    ran.push(file);
  }
  return ran;
}

/** Minimal splitter: our migrations contain no dollar-quoted bodies or semicolons inside strings. */
function splitSql(sql: string): string[] {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
