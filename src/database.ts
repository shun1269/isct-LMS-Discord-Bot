import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

export class PreparedStatement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly values: SQLInputValue[] = []) {}

  bind(...values: SQLInputValue[]): PreparedStatement { return new PreparedStatement(this.db, this.sql, values); }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values);
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...this.values) as T[] };
  }

  // batch() executes synchronously so a transaction cannot be interleaved.
  execute(): { meta: { changes: number } } {
    return { meta: { changes: Number(this.db.prepare(this.sql).run(...this.values).changes) } };
  }

  async run(): Promise<{ meta: { changes: number } }> { return this.execute(); }
}

export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string, migrationsDirectory: string | URL = resolve("migrations")) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(path, { timeout: 5_000 });
    try {
      this.connection.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;");
      this.connection.exec("CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
      for (const name of readdirSync(migrationsDirectory).filter((entry) => /^\d+.*\.sql$/.test(entry)).sort()) {
        if (this.connection.prepare("SELECT 1 FROM app_migrations WHERE name = ?").get(name)) continue;
        this.connection.exec("BEGIN IMMEDIATE");
        try {
          const root = migrationsDirectory instanceof URL ? fileURLToPath(migrationsDirectory) : migrationsDirectory;
          this.connection.exec(readFileSync(join(root, name), "utf8"));
          this.connection.prepare("INSERT INTO app_migrations VALUES (?, ?)").run(name, new Date().toISOString());
          this.connection.exec("COMMIT");
        } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
      }
    } catch (error) { this.connection.close(); throw error; }
  }

  prepare(sql: string): PreparedStatement { return new PreparedStatement(this.connection, sql); }

  async batch(statements: PreparedStatement[]): Promise<void> {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements) statement.execute();
      this.connection.exec("COMMIT");
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }

  close(): void { this.connection.close(); }
}
