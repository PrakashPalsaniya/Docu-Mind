# 🧠 DocuMind — Agentic PDF Intelligence

Upload any PDF and chat with it through an **agentic Retrieval-Augmented Generation (RAG)** pipeline. DocuMind grounds every answer in your document with citations, **falls back to web search** when the PDF doesn't have the answer, **self-corrects** when retrieval is weak, and **caches by meaning** so repeat questions return instantly.

> Built with LangGraph · Qdrant · local embeddings · OpenRouter · Langfuse

---

## ✨ Features

- **Agentic RAG (LangGraph state machine)** — query rewriting → hybrid retrieval → relevance grading → self-reflective re-retrieval → grounded generation with citations.
- **Hybrid retrieval + reranking** — dense vector search **+** BM25 keyword search fused with **Reciprocal Rank Fusion**, then re-ordered by a **cross-encoder re-ranker** for high precision.
- **Automatic web-search fallback** — if the document can't answer, the agent searches the web and cites the sources (answers are badged **"From the web"** vs **"From the document"**).
- **Semantic answer cache** — embeds each question and reuses a past answer when a **meaning-equivalent** question was already asked (cosine similarity ≥ threshold), skipping the whole pipeline. Cache hits are badged **⚡ Cached**.
- **Per-user document isolation** — every chunk is tagged with `userId` + `pdfId`; retrieval is filtered so users only ever query their own PDFs.
- **Live agent trace (streaming)** — the UI streams the agent's reasoning steps in real time over Server-Sent Events, with a **stop-generation** control.
- **Conversation memory** — recent turns are fed back so follow-up questions resolve references.
- **Background ingestion** — chunking + embeddings run in a **BullMQ** worker; PDF status (`PROCESSING → READY/FAILED`) is tracked in Postgres.
- **Auth** — Clerk protects both the UI and the API (Bearer token verified server-side), with a webhook syncing users to Postgres.
- **Observability** — agent runs are traced to **Langfuse** (steps, inputs, outputs).
- **Eval harness** — LLM-as-judge scoring for faithfulness & relevance.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite, Tailwind CSS, Clerk, `react-markdown` |
| **Backend** | Node.js + Express 5 |
| **Agent / Orchestration** | LangGraph + LangChain |
| **LLM** | OpenRouter (default `meta-llama/llama-3.1-8b-instruct`, configurable) |
| **Embeddings** | Local, on-device `Xenova/all-MiniLM-L6-v2` (384-dim, no API key) |
| **Retrieval** | Qdrant (dense) + in-memory BM25 (sparse) + RRF + cross-encoder rerank |
| **Web search** | Pluggable web-search fallback |
| **Cache** | Semantic cache in Qdrant (`qa_cache_local`) |
| **Queue** | BullMQ + Valkey (Redis) |
| **Database** | PostgreSQL + Prisma |
| **Observability** | Langfuse |
| **Infra** | Docker Compose |

---

## 🧩 Architecture

### Ingestion pipeline
```
Client → POST /upload/pdf (auth)
       → save file + create Pdf(status=PROCESSING)
       → enqueue job (BullMQ / Valkey)
       → Worker: load PDF → split into chunks
               → tag {userId, pdfId} → embed (MiniLM, local)
               → upsert to Qdrant → Pdf.status = READY
```

### Query pipeline (Agentic RAG)
```
Client → POST /chat/stream {query, pdfId} (auth)  ── streams SSE ──►

  ┌─────────────────────── Semantic Cache ───────────────────────┐
  │ embed(query) → search qa_cache_local                          │
  │   hit  → return cached answer  ⚡  (skip everything below)     │
  │   miss → run the agent ▼                                      │
  └──────────────────────────────────────────────────────────────┘

  LangGraph agent:
    rewrite ─► retrieve (hybrid: vector + BM25 → RRF → rerank)
            ─► grade relevance
                 ├─ relevant            ─► generate (cited answer)   [document]
                 ├─ weak & tries < 2    ─► rewrite & retry
                 └─ still weak          ─► web search ─► generate     [web]
                                              └─ nothing ─► "not found"
    → store answer in semantic cache
    → persist USER + AI turns (Postgres)
    → trace run to Langfuse
```

---

## 🚀 Getting Started

### 1. Start infrastructure (Postgres, Qdrant, Valkey)
```bash
docker compose up -d
```

### 2. Backend
```bash
cd server
cp .env.example .env      # fill in OPENROUTER_API_KEY, CLERK_SECRET_KEY, QDRANT_URL, DATABASE_URL, etc.
npm install
npm run prisma:generate
npm run prisma:migrate
node index.js             # API on :8000
node worker.js            # ingestion worker (separate terminal)
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env      # fill in VITE_CLERK_PUBLISHABLE_KEY + VITE_API_URL
npm install
npm run dev               # app on :5173
```

### 4. Evaluate retrieval quality (optional)
```bash
cd server
# set EVAL_USER_ID and EVAL_PDF_ID in .env for an ingested doc
npm run eval
```

---

## ⚙️ Key configuration (`server/.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | LLM access (OpenRouter) | — |
| `OPENROUTER_MODEL` | Chat model | `meta-llama/llama-3.1-8b-instruct` |
| `QDRANT_URL` | Vector DB URL | `http://localhost:6333` |
| `DATABASE_URL` | PostgreSQL connection | — |
| `SEMANTIC_CACHE_ENABLED` | Toggle the semantic cache | `true` |
| `SEMANTIC_CACHE_THRESHOLD` | Min cosine similarity for a cache hit | `0.85` |
| `SEMANTIC_CACHE_TTL_HOURS` | Ignore cache entries older than this | `168` |
| `LANGFUSE_*` | Observability (optional) | — |

---

## 📡 API

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/upload/pdf` | Upload a PDF (auth), queues ingestion |
| GET | `/pdfs` | List the current user's PDFs |
| POST | `/chat` | Ask a question `{query, pdfId}` (non-streaming) |
| POST | `/chat/stream` | Ask a question, stream agent trace + answer (SSE) |
| GET | `/chat/:pdfId` | Chat history for a PDF |
| POST | `/webhook/clerk` | Clerk user-sync webhook |

---

## 🧪 How to verify features quickly

- **Semantic cache:** ask a question, then ask it again (or a paraphrase). The second answer shows a **⚡ Cached** badge + toast, returns near-instantly, and logs `⚡ CACHE HIT …` in the backend terminal.
- **Web fallback:** ask something not covered by the PDF — the answer gets a **"From the web"** badge with linked sources.
- **Agentic self-correction:** watch the live trace — on weak retrieval it re-writes the query and retries before falling back to the web.
