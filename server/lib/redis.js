// Shared Redis/Valkey client used by the rate limiter.
import Redis from "ioredis";

let _client = null;

export function getRedis() {
  if (_client) return _client;

  _client = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT) || 6379,
    // fail fast if Valkey is down so the rate limiter can fail open instead of blocking traffic
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
