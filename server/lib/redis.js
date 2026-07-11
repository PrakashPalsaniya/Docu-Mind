import Redis from "ioredis";

export function baseConnection() {
  const conn = {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
  };
  if (process.env.REDIS_USERNAME) conn.username = process.env.REDIS_USERNAME;
  if (process.env.REDIS_PASSWORD) conn.password = process.env.REDIS_PASSWORD;
  return conn;
}

export function bullConnection() {
  return { ...baseConnection(), maxRetriesPerRequest: null };
}

let _client = null;

export function getRedis() {
  if (_client) return _client;

  _client = new Redis({
    ...baseConnection(),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  _client.on("error", (err) => {
    console.error("Redis error:", err.message);
  });

  return _client;
}

export async function closeRedis() {
  if (_client) {
    await _client.quit().catch(() => {});
    _client = null;
  }
}
