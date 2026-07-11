import { ChatOpenAI } from "@langchain/openai";
import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { rerank } from "./rerank.js";

const COLLECTION = "pdf_embeddings_local";
const VECTOR_SIZE = 384;

function newQdrantClient() {
  return new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
  });
}

export const embeddings = new HuggingFaceTransformersEmbeddings({
  model: "Xenova/all-MiniLM-L6-v2",
});

export function getChatModel(temperature = 0.3) {
  return new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct",
    temperature,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
  });
}

async function ensurePayloadIndex(client, collection, field) {
  try {
    await client.createPayloadIndex(collection, {
      field_name: field,
      field_schema: "keyword",
      wait: true,
    });
  } catch (err) {
    // ignore "already exists" and similar; filtering just needs the index present
    if (!/already exists|exists/i.test(err?.message || "")) {
      console.error(`ensurePayloadIndex ${collection}.${field}:`, err?.message || err);
    }
  }
}

async function ensureCollection() {
  const client = newQdrantClient();

  const { collections } = await client.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await client.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }

  // Qdrant Cloud requires payload indexes to filter on these fields.
  await ensurePayloadIndex(client, COLLECTION, "metadata.userId");
  await ensurePayloadIndex(client, COLLECTION, "metadata.pdfId");
}

export async function getVectorStore() {
  await ensureCollection();
  return QdrantVectorStore.fromExistingCollection(embeddings, {
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: COLLECTION,
  });
}

export async function deleteVectorsForPdf({ userId, pdfId }) {
  const client = newQdrantClient();
  try {
    await client.delete(COLLECTION, {
      filter: qdrantFilter(userId, pdfId),
      wait: true,
    });
  } catch (err) {
    console.error("deleteVectorsForPdf:", err?.message || err);
  }
}

export async function retrieveForPdf(query, { userId, pdfId, k = 4 }) {
  const store = await getVectorStore();
  const filter = {
    must: [
      { key: "metadata.userId", match: { value: userId } },
      { key: "metadata.pdfId", match: { value: pdfId } },
    ],
  };
  return store.similaritySearchWithScore(query, k, filter);
}

const qdrantFilter = (userId, pdfId) => ({
  must: [
    { key: "metadata.userId", match: { value: userId } },
    { key: "metadata.pdfId", match: { value: pdfId } },
  ],
});

async function loadAllChunks(userId, pdfId) {
  const client = newQdrantClient();

  const out = [];
  let offset = undefined;
  do {
    const res = await client.scroll(COLLECTION, {
      filter: qdrantFilter(userId, pdfId),
      with_payload: true,
      limit: 128,
      offset,
    });
    for (const p of res.points) {
      const payload = p.payload || {};
      out.push({
        content: payload.content ?? payload.page_content ?? "",
        metadata: payload.metadata ?? {},
      });
    }
    offset = res.next_page_offset;
  } while (offset);
  return out;
}

const tokenize = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function bm25Rank(query, docs, k = 10) {
  const N = docs.length;
  if (!N) return [];
  const k1 = 1.5;
  const b = 0.75;

  const docTokens = docs.map((d) => tokenize(d.content));
  const docLen = docTokens.map((t) => t.length);
  const avgdl = docLen.reduce((a, c) => a + c, 0) / N || 1;

  const df = new Map();
  docTokens.forEach((toks) => {
    new Set(toks).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });

  const qTerms = [...new Set(tokenize(query))];
  const scores = docTokens.map((toks, i) => {
    const tf = new Map();
    toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    let score = 0;
    for (const term of qTerms) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      const n = df.get(term) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score +=
        idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docLen[i]) / avgdl)));
    }
    return { doc: docs[i], score };
  });

  return scores
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((s) => s.doc);
}

function reciprocalRankFusion(lists, keyOf, kRRF = 60) {
  const agg = new Map();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const prev = agg.get(key) || { item, score: 0 };
      prev.score += 1 / (kRRF + rank + 1);
      agg.set(key, prev);
    });
  }
  return [...agg.values()].sort((a, b) => b.score - a.score).map((x) => x.item);
}

export async function hybridRetrieveForPdf(
  query,
  { userId, pdfId, k = 4, candidatePool = 10 }
) {
  const store = await getVectorStore();

  const dense = (
    await store.similaritySearch(query, candidatePool, qdrantFilter(userId, pdfId))
  ).map((d) => ({ content: d.pageContent, metadata: d.metadata }));

  const allChunks = await loadAllChunks(userId, pdfId);
  const sparse = bm25Rank(query, allChunks, candidatePool);

  const keyOf = (d) => (d.content || "").slice(0, 120);
  const fused = reciprocalRankFusion([dense, sparse], keyOf).slice(
    0,
    candidatePool
  );
  const pool = fused.length ? fused : dense;

  const reranked = await rerank(query, pool, k);
  return reranked;
}
