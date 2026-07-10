import { verifyToken } from "@clerk/backend";
import { prisma } from "./db.js";

// Verify the Clerk token, upsert the User row, attach req.userId.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    });

    const userId = payload.sub;
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: payload.email || `${userId}@placeholder.local`,
      },
    });

    req.userId = userId;
    next();
  } catch (err) {
    // a DB outage during upsert lands here too — distinguish from an auth failure
    const reason = err?.reason || err?.message || "unknown";
    const isDbDown = /reach database server|ECONNREFUSED/i.test(reason);
    console.error(isDbDown ? "DB unreachable during auth:" : "Auth error:", reason);
    return res
      .status(isDbDown ? 503 : 401)
      .json({ error: isDbDown ? "Service unavailable" : "Invalid token" });
  }

}



