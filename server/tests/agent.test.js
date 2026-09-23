import { jest } from "@jest/globals";

jest.unstable_mockModule("../lib/ai.js", () => ({
  getChatModel: () => ({
    invoke: async () => ({ content: "yes" }),
  }),
  hybridRetrieveForPdf: async () => [],
}));

jest.unstable_mockModule("../lib/webSearch.js", () => ({
  webSearch: async () => [],
}));

jest.unstable_mockModule("../lib/observability.js", () => ({
  withTrace: async (_meta, fn) => fn(() => {}),
}));

jest.unstable_mockModule("../lib/semanticCache.js", () => ({
  lookupCache: async () => null,
  storeInCache: jest.fn(),
}));

const { runAgent } = await import("../lib/agent.js");

describe("agent graph", () => {
  it("initializes without conflicting state-channel and node names", async () => {
    const result = await runAgent({
      question: "What is the answer?",
      userId: "user-1",
      pdfId: "pdf-1",
      history: [],
    });

    expect(result).toBeTruthy();
    expect(result.answer).toBeTruthy();
    expect(result.cached).toBe(false);
  });
});
