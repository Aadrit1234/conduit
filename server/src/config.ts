export type ServerConfig = {
  host: string;
  port: number;
  databaseUrl: string | null;
  /** Password for the /admin management API. Null disables the admin API. */
  adminPassword: string | null;
};

/**
 * Default admin password so /admin works out of the box (owner-set).
 * Override with ADMIN_PASSWORD, or set ADMIN_PASSWORD to an empty value to
 * disable the admin API entirely.
 */
export const DEFAULT_ADMIN_PASSWORD = "CONDUIT@2026";

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function loadConfig(): ServerConfig {
  // Unset ADMIN_PASSWORD -> the default password (admin enabled out of the box).
  // Set to an empty string -> null -> the admin API is disabled.
  const rawAdmin = process.env.ADMIN_PASSWORD;
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: intFromEnv("PORT", 8787),
    databaseUrl: process.env.DATABASE_URL ?? null,
    adminPassword: rawAdmin === undefined ? DEFAULT_ADMIN_PASSWORD : rawAdmin.trim() || null,
  };
}
