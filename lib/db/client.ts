import postgres from "postgres";

type SqlClient = ReturnType<typeof postgres>;

let cachedSql: SqlClient | null | undefined;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getSqlClient() {
  if (!process.env.DATABASE_URL) return null;

  if (cachedSql === undefined) {
    cachedSql = postgres(process.env.DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10
    });
  }

  return cachedSql;
}

export async function closeSqlClient() {
  if (cachedSql) await cachedSql.end();
  cachedSql = undefined;
}
