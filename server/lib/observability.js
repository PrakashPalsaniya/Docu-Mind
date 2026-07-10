// LLM observability via Langfuse: one trace per agent run. No-ops if keys unset.

let _client = null;
let _initTried = false;

async function getClient() {
  if (_initTried) return _client;
  _initTried = true;

  const { LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = process.env;
  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
    return null; // no keys, observability disabled
  }

  try {
    const { Langfuse } = await import("langfuse");
    _client = new Langfuse({
      publicKey: LANGFUSE_PUBLIC_KEY,
      secretKey: LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASEURL || "https://cloud.langfuse.com",
    });
  } catch (err) {
    console.error("Langfuse init failed, observability disabled:", err.message);
    _client = null;
  }
  return _client;
}

export function observabilityEnabled() {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

// Wrap an agent run in a Langfuse trace; `fn` gets a `report` callback.
export async function withTrace({ name, userId, input }, fn) {
  const client = await getClient();
  const start = Date.now();

  if (!client) {
    return fn(() => {}); // no-op reporter
  }

  const trace = client.trace({
    name,
    userId,
    input,
    metadata: { app: "chat-with-pdf-rag" },
  });

  const report = ({ steps = [], answer, sources = [], sourceType } = {}) => {
    try {
      // one span per reasoning step for a readable timeline
      steps.forEach((s, i) => {
        trace
          .span({ name: `step:${s.step || i}`, input: s.detail })
          .end({ output: s.detail });
      });
      trace.update({
        output: { answer, sourceType, sourceCount: sources.length },
        metadata: { latencyMs: Date.now() - start, sourceType },
      });
    } catch (err) {
      console.error("Langfuse report failed:", err.message);
    }
  };

  try {
    const result = await fn(report);
    return result;
  } finally {
    // best-effort flush; don't block the request on the network
    client.flushAsync?.().catch(() => {});
  }
}
