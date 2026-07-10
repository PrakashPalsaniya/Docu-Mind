// Distributed rate limiting via Redis/Valkey: atomic Lua fixed-window counter,
// global across instances, fails open if the backend is down.
import { getRedis } from "./redis.js";

const SLIDING_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { current, ttl }
`;

// Express middleware: allow `max` requests per `windowMs` per key.
export function rateLimit({ windowMs, max, name = "default", keyGenerator }) {
  const genKey =
    keyGenerator ||
    ((req) => req.userId || req.ip || req.connection?.remoteAddress || "anon");

  return async function rateLimitMiddleware(req, res, next) {
    const redis = getRedis();
    const identity = genKey(req);
    const key = `ratelimit:${name}:${identity}`;

    try {
      const [count, ttl] = await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(windowMs)
      );

      const remaining = Math.max(0, max - count);
      const resetSeconds = Math.ceil((ttl > 0 ? ttl : windowMs) / 1000);

      res.setHeader("RateLimit-Limit", max);
      res.setHeader("RateLimit-Remaining", remaining);
      res.setHeader("RateLimit-Reset", resetSeconds);

      if (count > max) {
        res.setHeader("Retry-After", resetSeconds);
        return res.status(429).json({
          error: "Too many requests. Please slow down.",
          retryAfter: resetSeconds,
        });
      }

      return next();
    } catch (err) {
      // fail open so a backend outage never blocks real users
      console.error("Rate limiter unavailable (allowing request):", err.message);
      return next();
    }
  };
}
