const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, token, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

export const api = {
  uploadPdf: (token, file) => {
    const form = new FormData();
    form.append("pdf", file);
    return request("/upload/pdf", token, {
      method: "POST",
      body: form,
    });
  },
  listPdfs: (token) => request("/pdfs", token),
  deletePdf: (token, pdfId) =>
    request(`/pdfs/${pdfId}`, token, { method: "DELETE" }),

  chat: (token, query, pdfId) =>
    request("/chat", token, {
      method: "POST",
      body: JSON.stringify({ query, pdfId }),
    }),
  // Streaming chat: calls onEvent(name, data) per SSE message.
  chatStream: async (token, query, pdfId, onEvent, signal) => {
    const res = await fetch(`${API_URL}/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, pdfId }),
      signal,
    });

    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Request failed");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (event === "done") return;
        try {
          onEvent(event, data ? JSON.parse(data) : {});
        } catch {
          // ignore malformed chunk
        }
      }
    }
  },
  history: (token, pdfId) => request(`/chat/${pdfId}`, token),
  // Fetch the PDF as an authed blob -> object URL (iframes can't send auth headers).
  pdfFileUrl: async (token, pdfId) => {
    const res = await fetch(`${API_URL}/pdfs/${pdfId}/file`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Failed to load PDF");
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },
};



