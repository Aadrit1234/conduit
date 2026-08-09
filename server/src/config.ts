export type ServerConfig = {
  host: string;
  port: number;
  databaseUrl: string | null;
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: intFromEnv("PORT", 8787),
    databaseUrl: process.env.DATABASE_URL ?? null,
  };
}
