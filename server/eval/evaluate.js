import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { getChatModel, retrieveForPdf } from "../lib/ai.js";
import { runAgent } from "../lib/agent.js";

dotenv.config();

// RAG eval harness: runs each question through the agent, then LLM-as-judge
// scores faithfulness / answer_relevancy / context_precision (1-5) into a report.
// Needs an ingested doc: EVAL_USER_ID=... EVAL_PDF_ID=... npm run eval
const USER_ID = process.env.EVAL_USER_ID;
const PDF_ID = process.env.EVAL_PDF_ID;

const testset = [
  { question: "What is the main topic of the document?" },
  { question: "Summarize the key points in a few sentences." },
  { question: "What are the most important terms or concepts mentioned?" },
];

function parseJson(text) {
  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return null;
  }
}

async function judge(question, context, answer) {
  const model = getChatModel(0);
  const prompt = `You are a strict RAG evaluator. Score each metric from 1 (worst) to 5 (best).
- faithfulness: the answer is supported ONLY by the context (penalize hallucination).
- answer_relevancy: the answer directly addresses the question.
- context_precision: the retrieved context is relevant to the question.
Return ONLY strict JSON: {"faithfulness":n,"answer_relevancy":n,"context_precision":n}

Question: ${question}

Context:
${context}

Answer:
${answer}`;
  const res = await model.invoke(prompt);
  return (
    parseJson(res.content.toString()) || {
      faithfulness: 0,
      answer_relevancy: 0,
      context_precision: 0,
    }
  );
}

async function main() {
  if (!USER_ID || !PDF_ID) {
    throw new Error("Set EVAL_USER_ID and EVAL_PDF_ID env vars first");
  }

  const rows = [];
  for (const { question } of testset) {
    const docs = await retrieveForPdf(question, {
      userId: USER_ID,
      pdfId: PDF_ID,
      k: 4,
    });
    const context = docs.map(([d]) => d.pageContent).join("\n---\n");

    const { answer, sourceType } = await runAgent({
      question,
      userId: USER_ID,
      pdfId: PDF_ID,
      history: [],
    });

    const score = await judge(question, context, answer);
    rows.push({ question, sourceType, ...score });
    console.log(
      `Q: ${question}\n  faithfulness=${score.faithfulness} answer_relevancy=${score.answer_relevancy} context_precision=${score.context_precision} (source: ${sourceType})`
    );
  }

  const avg = (key) =>
    (rows.reduce((s, x) => s + (x[key] || 0), 0) / rows.length).toFixed(2);

  const metrics = ["faithfulness", "answer_relevancy", "context_precision"];
  const summary = metrics.map((m) => `${m}: ${avg(m)}/5`).join("  |  ");

  let md = `# RAG Evaluation Report\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Model: \`${process.env.OPENROUTER_MODEL}\` · Embeddings: \`all-MiniLM-L6-v2\`\n\n`;
  md += `## Averages\n\n`;
  md += `| Metric | Score |\n|---|---|\n`;
  metrics.forEach((m) => (md += `| ${m} | ${avg(m)} / 5 |\n`));
  md += `\n## Per-question\n\n`;
  md += `| Question | Source | Faithfulness | Answer relevancy | Context precision |\n`;
  md += `|---|---|---|---|---|\n`;
  rows.forEach((r) => {
    md += `| ${r.question} | ${r.sourceType} | ${r.faithfulness} | ${r.answer_relevancy} | ${r.context_precision} |\n`;
  });

  const outPath = path.join(process.cwd(), "eval", "results.md");
  fs.writeFileSync(outPath, md);

  console.log(`\n${summary}`);
  console.log(`\nReport written to ${outPath}`);
}

main().then(() => process.exit(0));
