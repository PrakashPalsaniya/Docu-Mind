import { prisma } from "../lib/db.js";
import { deleteVectorsForPdf } from "../lib/ai.js";
import { buildKey, uploadBuffer, deleteObject, getObjectStream } from "../lib/s3.js";

export const uploadPdf = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const key = buildKey(req.userId, req.file.originalname);
    await uploadBuffer(key, req.file.buffer, req.file.mimetype);

    const pdf = await prisma.pdf.create({
      data: {
        name: req.file.originalname,
        fileUrl: key,
        userId: req.userId,
        status: "PROCESSING",
      },
    });

    await req.queue.add("file-ready", {
      s3Key: key,
      pdfId: pdf.id,
      userId: req.userId,
    });

    return res.json({ message: "PDF uploaded", pdf });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const getPdfFile = async (req, res) => {
  try {
    const { pdfId } = req.params;
    const pdf = await prisma.pdf.findFirst({
      where: { id: pdfId, userId: req.userId },
    });
    if (!pdf || !pdf.fileUrl)
      return res.status(404).json({ error: "PDF not found" });

    const { body, contentType, contentLength } = await getObjectStream(pdf.fileUrl);
    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    res.setHeader("Content-Disposition", `inline; filename="${pdf.name}"`);

    body.on("error", (err) => {
      console.error("PDF stream error:", err.message);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(err);
    });
    body.pipe(res);
  } catch (error) {
    console.error("Get PDF file error:", error);
    res.status(500).json({ error: error.message });
  }
};

export const deletePdf = async (req, res) => {
  try {
    const { pdfId } = req.params;
    const pdf = await prisma.pdf.findFirst({
      where: { id: pdfId, userId: req.userId },
    });
    if (!pdf) return res.status(404).json({ error: "PDF not found" });

    await deleteVectorsForPdf({ userId: req.userId, pdfId });

    if (pdf.fileUrl) {
      try {
        await deleteObject(pdf.fileUrl);
      } catch (e) {
        console.error("Failed to remove S3 object:", e.message);
      }
    }

    await prisma.pdf.delete({ where: { id: pdf.id } });

    return res.json({ message: "PDF deleted", id: pdf.id });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete PDF" });
  }
};

export const listPdfs = async (req, res) => {
  try {
    const pdfs = await prisma.pdf.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ pdfs });
  } catch (error) {
    console.error("List error:", error);
    res.status(500).json({ error: error.message });
  }
};
