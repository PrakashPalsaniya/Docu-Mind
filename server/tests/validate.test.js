import { jest } from "@jest/globals";
import {
  validate,
  chatBodySchema,
  pdfIdParamsSchema,
} from "../lib/validate.js";

// Builds a fake Express (req, res, next) trio for middleware testing.
function mockReqRes(reqData, source = "body") {
  const req = { [source]: reqData };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("validate() middleware — chat body", () => {
  const mw = validate(chatBodySchema);

  it("passes a valid body and calls next()", () => {
    const { req, res, next } = mockReqRes({ query: "What is this?", pdfId: "abc" });
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("trims and normalizes the parsed body", () => {
    const { req, res, next } = mockReqRes({ query: "  hi  ", pdfId: "  p1  " });
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.body.query).toBe("hi");
    expect(req.body.pdfId).toBe("p1");
  });

  it("rejects an empty query with 400 + field details", () => {
    const { req, res, next } = mockReqRes({ query: "   ", pdfId: "abc" });
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.details.some((d) => d.field === "query")).toBe(true);
  });

  it("rejects a missing pdfId", () => {
    const { req, res, next } = mockReqRes({ query: "hello" });
    mw(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an over-long query (>2000 chars)", () => {
    const { req, res, next } = mockReqRes({
      query: "x".repeat(2001),
      pdfId: "abc",
    });
    mw(req, res, next);
    expect(res.statusCode).toBe(400);
  });
});

describe("validate() middleware — pdfId params", () => {
  const mw = validate(pdfIdParamsSchema, "params");

  it("accepts a valid pdfId param", () => {
    const { req, res, next } = mockReqRes({ pdfId: "doc-123" }, "params");
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("rejects an empty pdfId param", () => {
    const { req, res, next } = mockReqRes({ pdfId: "" }, "params");
    mw(req, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
