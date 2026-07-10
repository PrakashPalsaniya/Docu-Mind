import { runAgent, streamAgent } from "../lib/agent.js";
import { prisma } from "../lib/db.js";

async function loadContext(userId, pdfId) {
  const pdf = await prisma.pdf.findFirst({ where: { id: pdfId, userId } });
  if (!pdf) return { error: "PDF not found", status: 404 };
  if (pdf.status !== "READY")
    return { error: "PDF is still being processed", status: 409 };

  const recent = await prisma.chat.findMany({
    where: { pdfId, userId },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  const history = recent.reverse().map((c) => ({
    role: c.role,
    content: c.content,
  }));
  return { history };
}

export const chatController = async (req, res) => {
  try {
    const userId = req.userId;
    const { query, pdfId } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query is required" });
    }
    if (!pdfId) {
      return res.status(400).json({ error: "pdfId is required" });
    }

    const ctx = await loadContext(userId, pdfId);
    if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

    const { answer, sources, sourceType, trace } = await runAgent({
      question: query,
      userId,
      pdfId,
      history: ctx.history,
    });

    await prisma.chat.createMany({
      data: [
        { role: "USER", content: query, pdfId, userId },
        { role: "AI", content: answer, sources, pdfId, userId },
      ],
    });

    return res.json({ answer, sources, sourceType, trace });
  } catch (error) {
    console.error("Error in /chat:", error);
    res.status(500).json({ error: error.message });
  }
};

// SSE endpoint: streams live agent steps + answer.
export const chatStreamController = async (req, res) => {
  const userId = req.userId;
  const { query, pdfId } = req.body;

  if (!query || typeof query !== "string" || !pdfId) {
    return res.status(400).json({ error: "query and pdfId are required" });
  }

  const ctx = await loadContext(userId, pdfId);
  if (ctx.error) return res.status(ctx.status).json({ error: ctx.error });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    let answer = "";
    let sources = [];
    let sourceType = "document";
    let cached = false;

    for await (const update of streamAgent({
      question: query,
      userId,
      pdfId,
      history: ctx.history,
    })) {
      if (update.token !== undefined) {
        send("token", { token: update.token });
        continue;
      }

      for (const [node, partial] of Object.entries(update)) {
        if (partial?.trace) {
          for (const t of partial.trace) send("trace", t);
        }
        if (partial?.cached) cached = true;
        if (partial?.sourceType) sourceType = partial.sourceType;
        if (partial?.answer !== undefined) {
          answer = partial.answer;
          sources = partial.sources || [];
        }
      }
    }

    await prisma.chat.createMany({
      data: [
        { role: "USER", content: query, pdfId, userId },
        { role: "AI", content: answer, sources, pdfId, userId },
      ],
    });

    send("final", { answer, sources, sourceType, cached });

    res.write("event: done\ndata: {}\n\n");
    res.end();
  } catch (error) {
    console.error("Error in /chat/stream:", error);
    send("error", { error: error.message });
    res.end();
  }
};

export const getChatHistory = async (req, res) => {
  try {
    const userId = req.userId;
    const { pdfId } = req.params;
    const chats = await prisma.chat.findMany({
      where: { pdfId, userId },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ chats });
  } catch (error) {
    console.error("Error fetching history:", error);
    res.status(500).json({ error: error.message });
  }
};
