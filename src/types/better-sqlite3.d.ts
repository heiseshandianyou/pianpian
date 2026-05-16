declare module "better-sqlite3" {
  class Database {
    constructor(filename: string);
    pragma(source: string): unknown;
    exec(source: string): unknown;
    prepare(source: string): Database.Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    close(): void;
  }

  namespace Database {
    type Database = InstanceType<typeof Database>;

    interface Statement {
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    }
  }

  export = Database;
}
