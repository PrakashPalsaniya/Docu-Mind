import { Webhook } from "svix";
import { prisma } from "../lib/db.js";

// Keeps Postgres users in sync with Clerk (create/update/delete).
export const clerkWebhook = async (req, res) => {
  try {
    const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
    const payload = wh.verify(req.body, {
      "svix-id": req.headers["svix-id"],
      "svix-timestamp": req.headers["svix-timestamp"],
      "svix-signature": req.headers["svix-signature"],
    });

    const { type, data } = payload;

    if (type === "user.created" || type === "user.updated") {
      const email = data.email_addresses?.[0]?.email_address;
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
      await prisma.user.upsert({
        where: { id: data.id },
        update: { email, name },
        create: { id: data.id, email, name },
      });
    } else if (type === "user.deleted") {
      await prisma.user.delete({ where: { id: data.id } }).catch(() => {});
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error.message);
    return res.status(400).json({ error: "Webhook verification failed" });
  }
};
