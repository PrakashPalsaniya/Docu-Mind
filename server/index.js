import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { Queue } from "bullmq";

import { requireAuth } from "./lib/auth.js";
import { rateLimit } from "./lib/rateLimit.js";
import {
  validate,
  chatBodySchema,
  pdfIdParamsSchema,
} from "./lib/validate.js";
import {
  uploadPdf,
  listPdfs,
  getPdfFile,
  deletePdf,
} from "./controllers/pdfController.js";


import {
  chatController,
  chatStreamController,
  getChatHistory,
} from "./controllers/chatController.js";
import { clerkWebhook } from "./controllers/clerkWebhook.js";
import { s3Enabled } from "./lib/s3.js";
import { bullConnection } from "./lib/redis.js";


dotenv.config();

if (!s3Enabled) {
  throw new Error(
    "S3 is not configured. Set AWS_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
  );
}

const app = express();

app.set("trust proxy", 1);

const queue = new Queue("file-upload-queue", {
  connection: bullConnection(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);


app.post(
  "/webhook/clerk",
  express.raw({ type: "application/json" }),
  clerkWebhook
);

app.use(express.json());

app.get("/", (req, res) => res.json({ status: 200, message: "All Good" }));

const attachQueue = (req, res, next) => {
  req.queue = queue;
  next();
};

const chatLimiter = rateLimit({ name: "chat", windowMs: 60_000, max: 20 });
const uploadLimiter = rateLimit({ name: "upload", windowMs: 60_000, max: 5 });
const readLimiter = rateLimit({ name: "read", windowMs: 60_000, max: 120 });

app.post(
  "/upload/pdf",
  requireAuth,
  uploadLimiter,
  attachQueue,
  upload.single("pdf"),
  uploadPdf
);
app.get("/pdfs", requireAuth, readLimiter, listPdfs);
app.get(
  "/pdfs/:pdfId/file",
  requireAuth,
  readLimiter,
  validate(pdfIdParamsSchema, "params"),
  getPdfFile
);
app.delete(
  "/pdfs/:pdfId",
  requireAuth,
  uploadLimiter,
  validate(pdfIdParamsSchema, "params"),
  deletePdf
);


app.post(
  "/chat",
  requireAuth,
  chatLimiter,
  validate(chatBodySchema),
  chatController
);
app.post(
  "/chat/stream",
  requireAuth,
  chatLimiter,
  validate(chatBodySchema),
  chatStreamController
);
app.get(
  "/chat/:pdfId",
  requireAuth,
  readLimiter,
  validate(pdfIdParamsSchema, "params"),
  getChatHistory
);


app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "File too large. Max size is 15MB."
        : `Upload error: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  if (err?.message?.startsWith("Only PDF")) {
    return res.status(400).json({ error: err.message });
  }
  if (err?.message?.startsWith("Origin not allowed by CORS")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server listening on PORT ${PORT}`));
