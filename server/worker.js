import { Worker } from "bullmq";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import fs from "fs";
import dotenv from "dotenv";
import { getVectorStore } from "./lib/ai.js";
import { prisma } from "./lib/db.js";
import { downloadToTemp } from "./lib/s3.js";
import { bullConnection } from "./lib/redis.js";

dotenv.config();

["OPENROUTER_API_KEY", "QDRANT_URL", "DATABASE_URL"].forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
});

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    const { s3Key, pdfId, userId } = job.data;
    console.log("Processing PDF:", { pdfId, userId, s3Key });

    let filePath = null;

    try {
      filePath = await downloadToTemp(s3Key);

      const docs = await new PDFLoader(filePath).load();
      const chunks = await splitter.splitDocuments(docs);

      const hasText = chunks.some((c) => (c.pageContent || "").trim().length > 0);
      if (!hasText) {
        throw new Error(
          "No readable text found. This looks like a scanned or image-only PDF (OCR isn't supported yet)."
        );
      }

      chunks.forEach((chunk) => {
        chunk.metadata.userId = userId;
        chunk.metadata.pdfId = pdfId;
      });

      const store = await getVectorStore();

      const BATCH = 50;
      for (let i = 0; i < chunks.length; i += BATCH) {
        await store.addDocuments(chunks.slice(i, i + BATCH));
      }

      await prisma.pdf.update({
        where: { id: pdfId },
        data: { status: "READY", statusMessage: null },
      });

      console.log(`Stored ${chunks.length} chunks for pdf ${pdfId}`);
    } catch (error) {
      console.error("Error processing job:", error);
      if (job.data?.pdfId) {
        const reason = (error?.message || "Unknown processing error").slice(0, 500);
        await prisma.pdf
          .update({
            where: { id: job.data.pdfId },
            data: { status: "FAILED", statusMessage: reason },
          })
          .catch(() => {});
      }
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error("Failed to clean up temp file:", e.message);
        }
      }
    }
  },
  {
    concurrency: 5,
    connection: bullConnection(),
  }
);

console.log("Worker started and waiting for jobs...");
export default worker;
