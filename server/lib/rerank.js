// Local cross-encoder reranker (ms-marco-MiniLM-L-6-v2). Lazily loaded; falls
// back to input order if the model fails to load.
let _crossEncoder = null;
let _loadFailed = false;

async function getCrossEncoder() {
  if (_crossEncoder || _loadFailed) return _crossEncoder;
  try {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import(
      "@xenova/transformers"
    );
    const model = "Xenova/ms-marco-MiniLM-L-6-v2";
    const [tokenizer, sequenceModel] = await Promise.all([
      AutoTokenizer.from_pretrained(model),
      AutoModelForSequenceClassification.from_pretrained(model, {
        quantized: true,
      }),
    ]);
    _crossEncoder = { tokenizer, model: sequenceModel };
  } catch (err) {
    console.error("Cross-encoder failed to load, skipping rerank:", err.message);
    _loadFailed = true;
  }
  return _crossEncoder;
}

// Rerank `candidates` (each with `content`) → top `topK` with `rerankScore`.
export async function rerank(query, candidates, topK = 4) {
  if (!candidates.length) return [];
  const ce = await getCrossEncoder();
  if (!ce) return candidates.slice(0, topK);

  try {
    const queries = candidates.map(() => query);
    const passages = candidates.map((c) => c.content);

    const inputs = ce.tokenizer(queries, {
      text_pair: passages,
      padding: true,
      truncation: true,
    });
    const { logits } = await ce.model(inputs);

    const scores = logits.tolist().map((row) => row[0]);
    return candidates
      .map((c, i) => ({ ...c, rerankScore: scores[i] }))
      .sort((a, b) => b.rerankScore - a.rerankScore)
      .slice(0, topK);
  } catch (err) {
    console.error("Rerank failed, using input order:", err.message);
    return candidates.slice(0, topK);
  }
}
