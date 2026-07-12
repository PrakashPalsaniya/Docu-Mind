import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { getChatModel, hybridRetrieveForPdf } from "./ai.js";
import { webSearch } from "./webSearch.js";
import { withTrace } from "./observability.js";
import { lookupCache, storeInCache } from "./semanticCache.js";



const GraphState = Annotation.Root({
  question: Annotation(),
  userId: Annotation(),
  pdfId: Annotation(),
  history: Annotation({ default: () => [] }),
  rewritten: Annotation(),
  docs: Annotation({ default: () => [] }),
  relevant: Annotation({ default: () => false }),
  tries: Annotation({ default: () => 0 }),
  answer: Annotation(),
  sources: Annotation({ default: () => [] }),
  sourceType: Annotation({ default: () => "document" }),
  noAnswer: Annotation({ default: () => false }),
  trace: Annotation({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});

function historyText(history = []) {
  if (!history.length) return "None.";
  return history
    .map((m) => `${m.role === "USER" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
}

async function rewriteNode(state) {
  const model = getChatModel(0);
  const prompt = `Rewrite the user's question into a standalone search query for retrieving passages from a PDF. Use the conversation history to resolve references. Return only the query.

History:
${historyText(state.history)}

Question: ${state.question}`;
  const res = await model.invoke(prompt);
  const rewritten = res.content.toString().trim();
  return {
    rewritten,
    tries: state.tries + 1,
    trace: [{ step: "rewrite", detail: `Search query: "${rewritten}"` }],
  };
}

async function retrieveNode(state) {
  const results = await hybridRetrieveForPdf(state.rewritten, {
    userId: state.userId,
    pdfId: state.pdfId,
    k: 4,
    candidatePool: 10,
  });
  const docs = results.map((doc, i) => ({
    id: i + 1,
    content: doc.content,
    page: doc.metadata?.loc?.pageNumber ?? doc.metadata?.page ?? "N/A",
    score: doc.rerankScore,
  }));
  return {
    docs,
    trace: [
      {
        step: "retrieve",
        detail: `Hybrid search (vector + BM25 + rerank) → ${docs.length} passages`,
      },
    ],
  };
}


async function gradeNode(state) {
  if (!state.docs.length) {
    return {
      relevant: false,
      trace: [{ step: "grade", detail: "No passages found in the PDF" }],
    };
  }
  const model = getChatModel(0);
  const context = state.docs.map((d) => d.content).join("\n---\n");
  const prompt = `Do the following passages contain information to answer the question? Answer only "yes" or "no".

Question: ${state.question}

Passages:
${context}`;
  const res = await model.invoke(prompt);
  const relevant = res.content.toString().toLowerCase().includes("yes");
  return {
    relevant,
    trace: [
      {
        step: "grade",
        detail: relevant
          ? "PDF passages are relevant"
          : "PDF passages are not relevant",
      },
    ],
  };
}

async function webSearchNode(state) {
  const results = await webSearch(state.rewritten || state.question, 4);
  const docs = results.map((r, i) => ({
    id: i + 1,
    content: r.content,
    url: r.url,
    title: r.title,
  }));
  return {
    docs,
    sourceType: "web",
    trace: [
      {
        step: "web_search",
        detail: `Not in the document — searched the web, found ${docs.length} results`,
      },
    ],
  };
}

async function generateNode(state) {
  const model = getChatModel(0.3);

  let context;
  let sources;
  if (state.sourceType === "web") {
    context = state.docs
      .map((d) => `[${d.id}] (${d.url}) ${d.content}`)
      .join("\n\n");
    sources = state.docs.map((d) => ({
      id: d.id,
      type: "web",
      url: d.url,
      title: d.title,
      snippet: (d.content || "").slice(0, 300),
    }));
  } else {
    context = state.docs
      .map((d) => `[${d.id}] (page ${d.page}) ${d.content}`)
      .join("\n\n");
    sources = state.docs.map((d) => ({
      id: d.id,
      type: "document",
      page: d.page,
      relevance:
        typeof d.score === "number"
          ? Math.round((1 / (1 + Math.exp(-d.score))) * 100)
          : undefined,
      snippet: d.content.slice(0, 300),
    }));

  }

  const origin =
    state.sourceType === "web"
      ? "web search results (this info is NOT from the PDF)"
      : "the PDF document";

  const prompt = `You are a helpful assistant. Answer the question using only the ${origin} below.
Cite the sources you use with their numbers like [1], [2].
If the context does not contain the answer, say you could not find it.

Context:
${context}

Conversation history:
${historyText(state.history)}

Question: ${state.question}`;

  const res = await model.invoke(prompt);
  return {
    answer: res.content.toString(),
    sources,
    trace: [
      {
        step: "generate",
        detail:
          state.sourceType === "web"
            ? "Generated answer from web sources"
            : "Generated answer from the document",
      },
    ],
  };
}

async function noAnswerNode() {
  return {
    answer:
      "I couldn't find information about that in this document or on the web. Try rephrasing your question.",
    sources: [],
    noAnswer: true,
    trace: [{ step: "no_answer", detail: "No relevant information found anywhere" }],
  };
}

function afterGrade(state) {
  if (state.relevant) return "generate";
  if (state.tries < 2) return "rewrite";
  return "webSearch";
}

function afterWebSearch(state) {
  return state.docs.length ? "generate" : "noAnswer";
}

const graph = new StateGraph(GraphState)
  .addNode("rewrite", rewriteNode)
  .addNode("retrieve", retrieveNode)
  .addNode("grade", gradeNode)
  .addNode("webSearch", webSearchNode)
  .addNode("generate", generateNode)
  .addNode("noAnswer", noAnswerNode)
  .addEdge(START, "rewrite")
  .addEdge("rewrite", "retrieve")
  .addEdge("retrieve", "grade")
  .addConditionalEdges("grade", afterGrade, {
    generate: "generate",
    rewrite: "rewrite",
    webSearch: "webSearch",
  })
  .addConditionalEdges("webSearch", afterWebSearch, {
    generate: "generate",
    noAnswer: "noAnswer",
  })
  .addEdge("generate", END)
  .addEdge("noAnswer", END)
  .compile();

export async function runAgent({ question, userId, pdfId, history }) {
  return withTrace(
    { name: "agent-run", userId, input: question },
    async (report) => {
      const cached = await lookupCache(question, { userId, pdfId });
      if (cached) {
        const trace = [
          {
            step: "cache",
            detail: `⚡ Answered from semantic cache (similarity ${cached.score.toFixed(
              2
            )} to "${cached.question}")`,
          },
        ];
        report({
          steps: trace,
          answer: cached.answer,
          sources: cached.sources,
          sourceType: cached.sourceType,
        });
        return {
          answer: cached.answer,
          sources: cached.sources,
          sourceType: cached.sourceType,
          trace,
          cached: true,
        };
      }

      const result = await graph.invoke({ question, userId, pdfId, history });

      if (!result.noAnswer) {
        storeInCache(question, {
          userId,
          pdfId,
          answer: result.answer,
          sources: result.sources,
          sourceType: result.sourceType,
        });
      }

      report({
        steps: result.trace,
        answer: result.answer,
        sources: result.sources,
        sourceType: result.sourceType,
      });
      return {
        answer: result.answer,
        sources: result.sources,
        sourceType: result.sourceType,
        trace: result.trace,
        cached: false,
      };
    }
  );
}


// Streaming variant: yields each node's state update for live UI trace.
export async function* streamAgent({ question, userId, pdfId, history }) {
  const collectedSteps = [];
  let finalAnswer;
  let finalSources = [];
  let finalSourceType = "document";
  let finalNoAnswer = false;

  const cached = await lookupCache(question, { userId, pdfId });
  if (cached) {
    yield {
      cache: {
        trace: [
          {
            step: "cache",
            detail: `⚡ Answered from semantic cache (similarity ${cached.score.toFixed(
              2
            )})`,
          },
        ],
        answer: cached.answer,
        sources: cached.sources,
        sourceType: cached.sourceType,
        cached: true,
      },
    };
    if (cached.answer) yield { token: cached.answer };
    return;
  }

  yield* (async function* () {
    const stream = await graph.stream(
      { question, userId, pdfId, history },
      { streamMode: ["updates", "messages"] }
    );
    for await (const [mode, chunk] of stream) {
      if (mode === "messages") {
        const [msg, metadata] = chunk;
        const token = msg?.content?.toString?.() || "";
        if (token && metadata?.langgraph_node === "generate") {
          yield { token };
        }
        continue;
      }

      for (const nodeState of Object.values(chunk)) {
        if (nodeState?.trace) collectedSteps.push(...nodeState.trace);
        if (nodeState?.answer !== undefined) finalAnswer = nodeState.answer;
        if (nodeState?.sources) finalSources = nodeState.sources;
        if (nodeState?.sourceType) finalSourceType = nodeState.sourceType;
        if (nodeState?.noAnswer) finalNoAnswer = true;
      }
      yield chunk;
    }
  })();

  if (!finalNoAnswer) {
    storeInCache(question, {
      userId,
      pdfId,
      answer: finalAnswer,
      sources: finalSources,
      sourceType: finalSourceType,
    });
  }

  withTrace({ name: "agent-stream", userId, input: question }, async (report) => {
    report({
      steps: collectedSteps,
      answer: finalAnswer,
      sources: finalSources,
      sourceType: finalSourceType,
    });
  }).catch(() => {});
}


