// Semantic answer cache: matches past questions by meaning to skip the pipeline.
// Config: SEMANTIC_CACHE_{ENABLED,THRESHOLD,TTL_HOURS}.
import { randomUUID } from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import { embeddings } from "./ai.js";

const CACHE_COLLECTION = "qa_cache_local";
const VECTOR_SIZE = 384; // must match all-MiniLM-L6-v2

const enabled = () =>
  (process.env.SEMANTIC_CACHE_ENABLED ?? "true").toLowerCase() !== "false";
const threshold = () =>
  parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD ?? "0.85");

const ttlMs = () =>
  parseFloat(process.env.SEMANTIC_CACHE_TTL_HOURS ?? "168") * 3600 * 1000;

let _client = null;
let _collectionReady = false;

function client() {
  if (!_client)
    _client = new QdrantClient({
      url: process.env.QDRANT_URL,
      checkCompatibility: false,
    });

  return _client;
}

async function ensureCollection() {
  if (_collectionReady) return;
  const c = client();
  const { collections } = await c.getCollections();
  if (!collections.some((x) => x.name === CACHE_COLLECTION)) {
    await c.createCollection(CACHE_COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
  }
  _collectionReady = true;
}

const filterFor = (userId, pdfId) => ({
  must: [
    { key: "userId", match: { value: userId } },
    { key: "pdfId", match: { value: pdfId } },
  ],
});

// Look up a meaning-equivalent past question. Returns payload on hit, null on miss.
export async function lookupCache(question, { userId, pdfId }) {
  if (!enabled()) return null;
  try {
    await ensureCollection();
    const vector = await embeddings.embedQuery(question);
    const results = await client().search(CACHE_COLLECTION, {
      vector,
      limit: 1,
      filter: filterFor(userId, pdfId),
      with_payload: true,
    });
    const hit = results?.[0];
    if (!hit || hit.score < threshold()) return null;

    const createdAt = hit.payload?.createdAt ?? 0;
    if (ttlMs() > 0 && Date.now() - createdAt > ttlMs()) return null;

    console.log(
      `⚡ CACHE HIT (similarity ${hit.score.toFixed(3)}) — skipped RAG+LLM pipeline for: "${question}"`
    );
    return {

      answer: hit.payload.answer,
      sources: hit.payload.sources ?? [],
      sourceType: hit.payload.sourceType ?? "document",
      question: hit.payload.question,
      score: hit.score,
    };
  } catch (err) {
    console.error("Semantic cache lookup failed (ignoring):", err.message);
    return null;
  }
}

// Store a fresh answer so future similar questions hit the cache. Never throws.
export async function storeInCache(
  question,
  { userId, pdfId, answer, sources = [], sourceType = "document" }
) {
  if (!enabled() || !answer) return;
  try {
    await ensureCollection();
    const vector = await embeddings.embedQuery(question);
    await client().upsert(CACHE_COLLECTION, {
      points: [
        {
          id: randomUUID(),
          vector,
          payload: {
            userId,
            pdfId,
            question,
            answer,
            sources,
            sourceType,
            createdAt: Date.now(),
          },
        },
      ],
    });
  } catch (err) {
    console.error("Semantic cache store failed (ignoring):", err.message);
  }
}

export function semanticCacheEnabled() {
  return enabled();
}
