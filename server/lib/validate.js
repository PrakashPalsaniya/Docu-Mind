// Zod request validation: 400 with field errors on failure, parsed value on success.
import { z } from "zod";

export function validate(schema, source = "body") {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: result.error.issues.map((i) => ({
          field: i.path.join(".") || source,
          message: i.message,
        })),
      });
    }
    req[source] = result.data;
    return next();
  };
}

// ---- Schemas -------------------------------------------------------------

export const chatBodySchema = z.object({
  query: z
    .string({ required_error: "query is required" })
    .trim()
    .min(1, "query cannot be empty")
    .max(2000, "query is too long (max 2000 chars)"),
  pdfId: z
    .string({ required_error: "pdfId is required" })
    .trim()
    .min(1, "pdfId is required"),
});

export const pdfIdParamsSchema = z.object({
  pdfId: z.string().trim().min(1, "pdfId is required"),
});
