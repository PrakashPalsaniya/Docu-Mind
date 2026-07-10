import { jest } from "@jest/globals";

// Mock the Redis client module BEFORE importing the rate limiter (ESM-safe).
const evalMock = jest.fn();
jest.unstable_mockModule("../lib/redis.js", () => ({
  getRedis: () => ({ eval: evalMock }),
  closeRedis: jest.fn(),
}));

const { rateLimit } = await import("../lib/rateLimit.js");

function mockReqRes(userId = "user-1") {
  const req = { userId, ip: "1.2.3.4" };
  const headers = {};
  const res = {
    statusCode: 200,
    body: null,
    setHeader: (k, v) => {
      headers[k] = v;
    },
    getHeader: (k) => headers[k],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next, headers };
}

beforeEach(() => {
  evalMock.mockReset();
});

describe("rateLimit() middleware", () => {
  it("allows a request under the limit and sets RateLimit headers", async () => {
    // count=1, ttl=60000ms
    evalMock.mockResolvedValue([1, 60_000]);
    const mw = rateLimit({ name: "test", windowMs: 60_000, max: 5 });
    const { req, res, next, headers } = mockReqRes();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(headers["RateLimit-Limit"]).toBe(5);
    expect(headers["RateLimit-Remaining"]).toBe(4);
    expect(headers["RateLimit-Reset"]).toBe(60);
  });

  it("blocks with 429 + Retry-After once the limit is exceeded", async () => {
    // count=6 exceeds max=5
    evalMock.mockResolvedValue([6, 30_000]);
    const mw = rateLimit({ name: "test", windowMs: 60_000, max: 5 });
    const { req, res, next, headers } = mockReqRes();

    await mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body.error).toMatch(/too many requests/i);
    expect(headers["Retry-After"]).toBe(30);
    expect(res.body.retryAfter).toBe(30);
  });

  it("reports 0 remaining exactly at the limit", async () => {
    evalMock.mockResolvedValue([5, 60_000]);
    const mw = rateLimit({ name: "test", windowMs: 60_000, max: 5 });
    const { req, res, next, headers } = mockReqRes();

    await mw(req, res, next);

    expect(next).toHaveBeenCalled(); // 5 == max is still allowed
    expect(headers["RateLimit-Remaining"]).toBe(0);
  });

  it("fails OPEN (allows request) when Redis throws", async () => {
    evalMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const mw = rateLimit({ name: "test", windowMs: 60_000, max: 5 });
    const { req, res, next } = mockReqRes();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("keys per user (different users get independent buckets)", async () => {
    evalMock.mockResolvedValue([1, 60_000]);
    const mw = rateLimit({ name: "test", windowMs: 60_000, max: 5 });

    const a = mockReqRes("user-A");
    const b = mockReqRes("user-B");
    await mw(a.req, a.res, a.next);
    await mw(b.req, b.res, b.next);

    // The Redis key must include each distinct user id.
    const keysUsed = evalMock.mock.calls.map((c) => c[2]);
    expect(keysUsed).toContain("ratelimit:test:user-A");
    expect(keysUsed).toContain("ratelimit:test:user-B");
  });
});
