# 🧠 DocuMind — Agentic PDF Intelligence

Upload a PDF and chat with it through an **agentic Retrieval-Augmented Generation (RAG)** pipeline. DocuMind grounds every answer in your document with citations, **falls back to web search** when the PDF doesn't have the answer, **self-corrects** when retrieval is weak, and **caches by meaning** so repeat questions return instantly.

> LangGraph · Qdrant · local embeddings (no embedding API key) · OpenRouter · Langfuse

---

## ✨ Features

- **Agentic RAG (LangGraph state machine)** — query rewriting → hybrid retrieval → relevance grading → self-reflective retry → grounded generation with citations.
- **Hybrid retrieval + reranking** — dense vector search **+** BM25 keyword search fused with **Reciprocal Rank Fusion**, then re-ordered by a local **cross-encoder re-ranker**.
- **Automatic web-search fallback** — if the document can't answer after retries, the agent searches the web and cites sources (answers badged **"From the web"** vs **"From the document"**).
- **Semantic answer cache** — embeds each question and reuses a past answer when a *meaning-equivalent* question was already asked (cosine ≥ threshold), skipping the entire pipeline. Hits are badged **⚡ Cached**.
- **Per-user document isolation** — every chunk is tagged `userId` + `pdfId`; all retrieval, caching, and history reads are filtered so users only touch their own PDFs.
- **Live agent trace (streaming)** — the UI streams reasoning steps *and* answer tokens in real time over SSE, with stop-generation.
- **Conversation memory** — the last 6 turns are fed back so follow-ups resolve references ("what about *its* pricing?").
- **Background ingestion** — chunking + embeddings run in a **BullMQ** worker; status (`PROCESSING → READY / FAILED`) tracked in Postgres with a failure reason.
- **Auth** — Clerk protects UI and API (Bearer token verified server-side), with an Svix-verified webhook syncing users to Postgres.
- **Distributed rate limiting** — atomic Redis/Valkey Lua fixed-window counter, shared across instances, fails open.
- **Observability** — every agent run traced to **Langfuse** (one span per reasoning step, latency, source type). No-ops without keys.
- **Eval harness** — LLM-as-judge scoring for faithfulness & relevance.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite 5, Tailwind CSS, Clerk, `react-markdown`, `sonner` |
| **Backend** | Node.js (ESM) + Express 5 |
| **Agent** | LangGraph `StateGraph` + LangChain |
| **LLM** | OpenRouter (default `meta-llama/llama-3.1-8b-instruct`, configurable) |
| **Embeddings** | Local on-device `Xenova/all-MiniLM-L6-v2` — 384-dim, **no API key** |
| **Reranker** | Local cross-encoder `Xenova/ms-marco-MiniLM-L-6-v2` |
| **Retrieval** | Qdrant (dense) + in-process BM25 (sparse) + RRF + cross-encoder rerank |
| **Web search** | Tavily if `TAVILY_API_KEY` is set, else keyless DuckDuckGo |
| **Cache** | Semantic cache in Qdrant (`qa_cache_local`) |
| **Queue** | BullMQ + Valkey/Redis |
| **Database** | PostgreSQL + Prisma |
| **File storage** | AWS S3 (required) |
| **Observability** | Langfuse |
| **Infra** | Docker Compose |

---

## 🧩 Architecture

### Ingestion pipeline

```
Client → POST /upload/pdf (auth, 5/min, ≤15MB, PDF-only)
       → upload buffer to S3  (uploads/<userId>/<uuid>-<name>.pdf)
       → create Pdf(status=PROCESSING) in Postgres
       → enqueue job on "file-upload-queue" (BullMQ / Valkey)
       ↓
Worker (concurrency 5)
       → download from S3 to temp → PDFLoader → split (1000 chars / 200 overlap)
       → reject scanned/image-only PDFs (no OCR yet) → status=FAILED + reason
       → tag every chunk {userId, pdfId} → embed locally (MiniLM)
       → upsert to Qdrant in batches of 50 → status=READY → delete temp file
```

### Query pipeline (Agentic RAG)

```
Client → POST /chat/stream {query, pdfId} (auth, 20/min)  ── streams SSE ──►

  ┌────────────────────── Semantic Cache ───────────────────────┐
  │ embed(query) → search qa_cache_local (filtered userId+pdfId) │
  │   score ≥ 0.85 & within TTL → return cached answer ⚡        │
  │   miss / error (fails open)  → run the agent ▼               │
  └─────────────────────────────────────────────────────────────┘

  LangGraph agent:
    rewrite ─► retrieve (dense + BM25 → RRF → rerank, top 4)
            ─► grade relevance (LLM yes/no)
                 ├─ relevant           ─► generate (cited)        [document]
                 ├─ weak & tries < 2   ─► rewrite & retry ↺
                 └─ still weak         ─► webSearch ─► generate   [web]
                                            └─ no results ─► noAnswer
    → cache the answer (skipped when noAnswer)
    → persist USER + AI turns to Postgres
    → trace the run to Langfuse
```

### Retrieval internals

1. **Dense** — Qdrant cosine similarity over `pdf_embeddings_local`, filtered by `metadata.userId` + `metadata.pdfId` (payload indexes created on demand — Qdrant Cloud requires them to filter). Pulls a 10-doc candidate pool.
2. **Sparse** — Okapi BM25 (`k1=1.5`, `b=0.75`) computed in-process over all chunks of that PDF, scrolled from Qdrant in pages of 128.
3. **Fusion** — Reciprocal Rank Fusion (`k=60`) merges both ranked lists, deduping on a content prefix. Falls back to the dense list if fusion yields nothing.
4. **Rerank** — local cross-encoder scores each candidate against the query and returns the top 4. If the model fails to load, it degrades gracefully to input order.

Document relevance shown in the UI is the rerank logit squashed through a sigmoid.

### Streaming contract (SSE)

`POST /chat/stream` emits named events:

| Event | Payload | Meaning |
|-------|---------|---------|
| `trace` | `{step, detail}` | one agent reasoning step |
| `token` | `{token}` | answer token from the `generate` node |
| `final` | `{answer, sources, sourceType, cached}` | complete result |
| `done` | `{}` | stream finished |
| `error` | `{error}` | failure mid-stream |

Turns are persisted **once** (idempotent `saved` guard) — including when the client disconnects mid-generation or the stream errors, so a stopped generation is never lost.

### Data model (Prisma)

```
User  1───n  Pdf  1───n  Chat
                  └─ status: PROCESSING | READY | FAILED  (+ statusMessage)
      └───n  Chat    role: USER | AI, sources Json?
```

All relations cascade on delete. Deleting a PDF also removes its Qdrant vectors and the S3 object.

---

## 🚀 Getting Started

### 1. Infrastructure (Postgres, Qdrant, Valkey, Adminer)

```bash
docker compose up -d
```

| Service | Port |
|---------|------|
| Postgres | `5432` (`admin` / `secret` / `pdf_rag`) |
| Qdrant | `6333` |
| Valkey (Redis) | `6379` |
| Adminer (DB UI) | `8080` |

### 2. Backend

```bash
cd server
cp .env.example .env      # see configuration below — S3 + Clerk + OpenRouter are required
npm install
npm run prisma:generate
npm run prisma:migrate

npm start                 # API on :8000
npm run start:worker      # ingestion worker (separate terminal)
# or run both together:
npm run start:all
```

> The API **throws at boot** if S3 isn't configured, and the worker throws if `OPENROUTER_API_KEY`, `QDRANT_URL`, or `DATABASE_URL` are missing — fail fast instead of failing mid-upload.

First run downloads the embedding + reranker models (~120MB) to a local cache; startup is slower once.

### 3. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_CLERK_PUBLISHABLE_KEY + VITE_API_URL
npm install
npm run dev               # app on :5173
```

### 4. Tests & eval (optional)

```bash
cd server
npm test                  # Jest (ESM) — rate limiter + request validation
npm run eval              # LLM-as-judge faithfulness / relevance
```

For `npm run eval`, set `EVAL_USER_ID` and `EVAL_PDF_ID` in `.env` to an already-ingested document.

---

## ⚙️ Configuration (`server/.env`)

**Required**

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM access |
| `DATABASE_URL` | PostgreSQL connection string |
| `QDRANT_URL` | Vector DB URL (`http://localhost:6333` locally) |
| `CLERK_SECRET_KEY` | Verifies API Bearer tokens |
| `CLERK_WEBHOOK_SECRET` | Verifies the Svix-signed user-sync webhook |
| `AWS_REGION`, `S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | PDF storage (all four needed) |

**Optional**

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_MODEL` | Chat model | `meta-llama/llama-3.1-8b-instruct` |
| `QDRANT_API_KEY` | For Qdrant Cloud | — |
| `REDIS_HOST`, `REDIS_PORT` | Queue + rate-limit backend | `localhost`, `6379` |
| `REDIS_USERNAME`, `REDIS_PASSWORD` | Redis auth (managed Redis / Valkey) | — |
| `TAVILY_API_KEY` | Better web search (else DuckDuckGo) | — |
| `CORS_ORIGINS` | Comma-separated allowlist | `http://localhost:5173,http://127.0.0.1:5173` |
| `PORT` | API port | `8000` |
| `SEMANTIC_CACHE_ENABLED` | Toggle the semantic cache | `true` |
| `SEMANTIC_CACHE_THRESHOLD` | Min cosine similarity for a hit | `0.85` |
| `SEMANTIC_CACHE_TTL_HOURS` | Ignore entries older than this | `168` |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASEURL` | Observability | disabled |

---

## 📡 API

All routes except `/` and `/webhook/clerk` require `Authorization: Bearer <clerk-token>`.

| Method | Route | Description | Limit |
|--------|-------|-------------|-------|
| `GET` | `/` | Health check | — |
| `POST` | `/upload/pdf` | Upload a PDF (multipart `pdf`, ≤15MB), queues ingestion | 5/min |
| `GET` | `/pdfs` | List the current user's PDFs | 120/min |
| `GET` | `/pdfs/:pdfId/file` | Stream the PDF back for in-app viewing | 120/min |
| `DELETE` | `/pdfs/:pdfId` | Delete PDF + its vectors + its S3 object | 5/min |
| `POST` | `/chat` | Ask `{query, pdfId}` (non-streaming) | 20/min |
| `POST` | `/chat/stream` | Ask `{query, pdfId}`, stream trace + tokens (SSE) | 20/min |
| `GET` | `/chat/:pdfId` | Full chat history for a PDF | 120/min |
| `POST` | `/webhook/clerk` | Clerk user-sync webhook (Svix-verified raw body) | — |

Chat returns `409` while a PDF is still `PROCESSING`, and `404` if the PDF isn't yours.

---

## 📁 Project layout

```
server/
  index.js               Express app, routes, CORS, rate limits, error handling
  worker.js              BullMQ ingestion worker
  start-all.js           runs API + worker in one process
  controllers/           pdf, chat (incl. SSE), clerk webhook
  lib/
    agent.js             LangGraph state machine (the agentic RAG loop)
    ai.js                embeddings, chat model, hybrid retrieval, BM25, RRF
    rerank.js            local cross-encoder reranker
    semanticCache.js     meaning-based answer cache in Qdrant
    webSearch.js         Tavily → DuckDuckGo fallback
    rateLimit.js         Redis Lua fixed-window limiter
    observability.js     Langfuse tracing
    auth.js  db.js  redis.js  s3.js  validate.js
  prisma/                schema + migrations
  eval/evaluate.js       LLM-as-judge eval harness
  tests/                 Jest tests

frontend/src/
  App.jsx                layout, PDF list, upload, auth gate
  components/            ChatArea (SSE + trace UI), FileUpload, PdfViewer, …
  lib/api.js             axios client + Clerk token injection
```

---

## 🧪 Verify the interesting bits quickly

- **Semantic cache** — ask a question, then ask a *paraphrase*. The second answer returns near-instantly with a **⚡ Cached** badge, and the backend logs `⚡ CACHE HIT (similarity 0.9xx) — skipped RAG+LLM pipeline`.
- **Web fallback** — ask something the PDF doesn't cover. The answer gets a **"From the web"** badge with linked sources.
- **Self-correction** — watch the live trace: on weak retrieval it rewrites the query and retries (up to 2 attempts) before touching the web.
- **Isolation** — sign in as another user and request the first user's `pdfId` → `404`, never a leaked chunk.
- **Resilience** — stop the generation mid-stream; reload the page. The partial turn is still in history.

---

## 🧭 Known limits

- **No OCR** — scanned / image-only PDFs are rejected at ingestion with a clear `FAILED` reason.
- **BM25 is in-process** — all chunks of the queried PDF are scrolled from Qdrant per request. Fine for single documents; a server-side sparse index is the upgrade path for large corpora.
- **Fixed-window rate limiting** — allows a burst at window edges; a sliding window is the upgrade if that matters.
