// Test-only tagged SQL adapter keeps integration fixtures on the same `pg` driver as production.
import { Pool, type PoolClient, type QueryResultRow } from "pg";

const jsonParameter = Symbol("jsonParameter");

type JsonParameter = {
  [jsonParameter]: true;
  value: unknown;
};

type EndOptions = {
  timeout?: number;
};

export type Sql = {
  <T extends QueryResultRow[] = QueryResultRow[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  json(value: unknown): JsonParameter;
  unsafe<T extends QueryResultRow[] = QueryResultRow[]>(query: string, values?: unknown[]): Promise<T>;
  begin<T>(callback: (transaction: Sql) => Promise<T>): Promise<T>;
  end(options?: EndOptions): Promise<void>;
};

function isJsonParameter(value: unknown): value is JsonParameter {
  return Boolean(value && typeof value === "object" && jsonParameter in value);
}

function compile(strings: TemplateStringsArray, values: unknown[]) {
  const parameters: unknown[] = [];
  let text = strings[0] ?? "";
  values.forEach((value, index) => {
    parameters.push(isJsonParameter(value) ? JSON.stringify(value.value) : value);
    text += `$${parameters.length}${strings[index + 1] ?? ""}`;
  });
  return { text, parameters };
}

function createSqlExecutor(
  query: <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>,
  begin: <T>(callback: (transaction: Sql) => Promise<T>) => Promise<T>,
  end: () => Promise<void>,
): Sql {
  const sql = async <T extends QueryResultRow[] = QueryResultRow[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> => {
    const compiled = compile(strings, values);
    const result = await query<QueryResultRow>(compiled.text, compiled.parameters);
    return result.rows as T;
  };

  const tagged = sql as Sql;
  tagged.json = (value) => ({ [jsonParameter]: true, value });
  tagged.unsafe = async <T extends QueryResultRow[] = QueryResultRow[]>(statement: string, values = []) => {
    const result = await query<QueryResultRow>(statement, values);
    return result.rows as T;
  };
  tagged.begin = (callback) => begin(callback);
  tagged.end = async () => end();
  return tagged;
}

function transactionSql(client: PoolClient): Sql {
  const reference: { current?: Sql } = {};
  const transaction = createSqlExecutor(
    (text, values) => client.query(text, values),
    async (callback) => callback(reference.current!),
    async () => undefined,
  );
  reference.current = transaction;
  return transaction;
}

export function createTestSqlClient(connectionString: string, max = 3): Sql {
  const pool = new Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  });
  return createSqlExecutor(
    (text, values) => pool.query(text, values),
    async (callback) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await callback(transactionSql(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    () => pool.end(),
  );
}
