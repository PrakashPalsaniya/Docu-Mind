import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

dotenv.config();

export const s3Enabled = Boolean(
  process.env.AWS_REGION &&
    process.env.S3_BUCKET &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
);

let _client = null;
function client() {
  if (!_client) {
    _client = new S3Client({ region: process.env.AWS_REGION });
  }
  return _client;
}

const bucket = () => process.env.S3_BUCKET;

export function buildKey(userId, originalName) {
  const safe = (originalName || "file.pdf").replace(/[^\w.\-]/g, "_");
  return `uploads/${userId}/${randomUUID()}-${safe}`;
}

export async function uploadBuffer(key, buffer, contentType = "application/pdf") {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return key;
}

export async function getObjectStream(key) {
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
  return {
    body: res.Body,
    contentType: res.ContentType || "application/pdf",
    contentLength: res.ContentLength,
  };
}

export async function downloadToTemp(key) {
  const res = await client().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key })
  );
  const tmpPath = path.join(os.tmpdir(), `${randomUUID()}.pdf`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    res.Body.pipe(out);
    res.Body.on("error", reject);
    out.on("finish", resolve);
  });
  return tmpPath;
}

export async function deleteObject(key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

export async function getViewUrl(key, expiresIn = 300) {
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn }
  );
}
