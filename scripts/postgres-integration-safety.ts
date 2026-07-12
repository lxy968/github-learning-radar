export function assertPostgresIntegrationTarget(databaseUrl: string | undefined, confirmation: string | undefined) {
  if (confirmation !== "1") {
    throw new Error("PostgreSQL integration test requires ALLOW_POSTGRES_INTEGRATION_TEST=1.");
  }
  if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration testing.");
  const databaseName = getDatabaseName(databaseUrl);
  if (!databaseName.includes("test") && !databaseName.includes("integration")) {
    throw new Error("PostgreSQL integration test refuses a database whose name does not contain 'test' or 'integration'.");
  }
}

function getDatabaseName(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("Unexpected database protocol.");
    return decodeURIComponent(url.pathname.replace(/^\//, "")).toLowerCase();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
}
