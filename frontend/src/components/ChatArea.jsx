import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  FileText,
  SendHorizonal,
  User,
  Bot,
  Copy,
  ChevronDown,
  Globe,
  Loader2,
  Check,
  Square,
  ArrowDown,
  Sparkles,
  MessageSquareText,
} from "lucide-react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { api } from "../lib/api";
import PdfViewer from "./PdfViewer";


function Markdown({ children }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
          code: ({ inline, ...props }) =>
            inline ? (
              <code
                className="bg-slate-100 text-pink-600 px-1 py-0.5 rounded text-[0.85em]"
                {...props}
              />
            ) : (
              <code
                className="block bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto text-xs"
                {...props}
              />
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}


const STEP_LABELS = {
  cache: "Answered from cache",
  rewrite: "Reformulating query",
  retrieve: "Searching the document",
  grade: "Checking relevance",
  web_search: "Searching the web",
  generate: "Writing answer",
  no_answer: "No answer found",
};


export default function ChatArea({ selectedPdfId, selectedPdf }) {
  const { getToken } = useAuth();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openSources, setOpenSources] = useState(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [viewerPage, setViewerPage] = useState(null);

  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    setShowScrollDown(!nearBottom);
  };

  const stop = () => {
    abortRef.current?.abort();
  };


  useEffect(() => {
    const load = async () => {
      if (!selectedPdfId) {
        setMessages([]);
        return;
      }
      const token = await getToken();
      if (!token) return;
      const { chats } = await api.history(token, selectedPdfId);
      setMessages(
        chats.map((c) => ({
          role: c.role === "USER" ? "user" : "assistant",
          content: c.content,
          sources: c.sources,
          sourceType: Array.isArray(c.sources) && c.sources[0]?.type === "web"
            ? "web"
            : "document",
        }))
      );
    };
    load();
  }, [selectedPdfId, getToken]);

  const send = async (preset) => {
    const userMsg = (typeof preset === "string" ? preset : message).trim();
    if (!userMsg || !selectedPdfId || loading) return;
    setMessage("");

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg },
      { role: "assistant", content: "", trace: [], streaming: true },
    ]);

    const patchLast = (patch) =>
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        copy[copy.length - 1] =
          typeof patch === "function" ? patch(last) : { ...last, ...patch };
        return copy;
      });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");

      await api.chatStream(
        token,
        userMsg,
        selectedPdfId,
        (event, data) => {
          if (event === "trace") {
            patchLast((last) => ({
              ...last,
              trace: [...(last.trace || []), data],
            }));
          } else if (event === "token") {
            patchLast((last) => ({
              ...last,
              content: (last.content || "") + (data.token || ""),
            }));
          } else if (event === "final") {
            if (data.cached) toast("⚡ Served instantly from cache");
            patchLast((last) => ({
              ...last,
              content: data.answer || last.content,
              sources: data.sources,
              sourceType: data.sourceType,
              cached: data.cached,
              streaming: false,
            }));
          } else if (event === "error") {

            patchLast({ content: "Error: " + data.error, streaming: false });
          }
        },
        controller.signal
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        patchLast((last) => ({
          ...last,
          content: last.content || "_Generation stopped._",
          streaming: false,
        }));
      } else {
        toast.error("Failed to get response");
        patchLast({
          content:
            "Error: " + (error instanceof Error ? error.message : "unknown"),
          streaming: false,
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };


  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b bg-white">
        <h2 className="font-semibold">PDF Assistant</h2>
        <p className="text-xs text-slate-400">
          {selectedPdf ? selectedPdf.name : "Select a document"}
        </p>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-y-auto p-6 space-y-6"
      >
        {!selectedPdfId ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
            <FileText className="w-12 h-12" />
            <p className="text-lg font-semibold text-slate-600">Select a PDF</p>
            <p className="max-w-sm text-sm">
              Upload and pick a document to start chatting.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-5">
            <div className="p-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-700">
                Ask anything about
              </p>
              <p className="text-sm text-slate-400 max-w-xs truncate">
                {selectedPdf?.name || "your document"}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-xl">
              {[
                "Summarize this document in 5 bullet points",
                "What are the key takeaways?",
                "Explain the main topic in simple terms",
                "Are there any important dates or numbers?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="flex items-center gap-2 text-left text-sm text-slate-600 bg-white border rounded-xl px-4 py-3 hover:border-blue-400 hover:bg-blue-50 transition"
                >
                  <MessageSquareText className="w-4 h-4 text-blue-500 shrink-0" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (

            <div
              key={i}
              className={`flex gap-3 ${
                msg.role === "user" ? "flex-row-reverse" : ""
              }`}
            >
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-white border text-blue-600"
                }`}
              >
                {msg.role === "user" ? (
                  <User className="w-4 h-4" />
                ) : (
                  <Bot className="w-4 h-4" />
                )}
              </div>

              <div
                className={`flex flex-col max-w-[80%] ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                {msg.role === "assistant" &&
                  msg.trace &&
                  msg.trace.length > 0 &&
                  (msg.streaming || !msg.content) && (
                    <div className="mb-2 w-full max-w-md space-y-1.5 bg-slate-50 border border-slate-100 rounded-xl p-3">
                      {msg.trace.map((t, ti) => {
                        const isActive =
                          msg.streaming && ti === msg.trace.length - 1;
                        return (
                          <div
                            key={ti}
                            className={`flex items-center gap-2 text-xs transition-colors ${
                              isActive ? "text-slate-700" : "text-slate-400"
                            }`}
                          >
                            {isActive ? (
                              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            )}
                            <span
                              className={`font-medium ${
                                t.step === "web_search" ? "text-emerald-600" : ""
                              }`}
                            >
                              {STEP_LABELS[t.step] || t.step}
                            </span>
                            <span className="text-slate-400 truncate">
                              — {t.detail}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}


                {(msg.content || msg.role === "user" || !msg.streaming) && (
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm leading-relaxed group relative ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-white border text-slate-800"
                    }`}
                  >
                    {msg.role === "assistant" && msg.streaming && !msg.content ? (
                      <span className="inline-flex items-center gap-2 text-slate-400">
                        <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
                      </span>
                    ) : msg.role === "assistant" ? (
                      <Markdown>{msg.content}</Markdown>
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}

                    {msg.role === "assistant" && msg.content && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(msg.content);
                          toast.success("Copied");
                        }}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-100 rounded"
                      >
                        <Copy className="w-3 h-3 text-slate-400" />
                      </button>
                    )}
                  </div>
                )}

                {msg.role === "assistant" && msg.content && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {msg.cached && (
                      <span
                        title="This answer was served from the semantic cache — a similar question was asked before, so the full pipeline (retrieval + LLM) was skipped."
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200"
                      >
                        ⚡ Cached
                      </span>
                    )}
                    {msg.sourceType && (
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          msg.sourceType === "web"
                            ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                            : "bg-blue-50 text-blue-600 border border-blue-200"
                        }`}
                      >
                        {msg.sourceType === "web" ? (
                          <>
                            <Globe className="w-3 h-3" /> From the web
                          </>
                        ) : (
                          <>
                            <FileText className="w-3 h-3" /> From the document
                          </>
                        )}
                      </span>
                    )}
                  </div>
                )}


                {msg.role === "assistant" &&
                  msg.sources &&
                  msg.sources.length > 0 && (
                    <div className="mt-2 w-full max-w-md">
                      <button
                        onClick={() =>
                          setOpenSources(openSources === i ? null : i)
                        }
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600"
                      >
                        <FileText className="w-3 h-3" />
                        View {msg.sources.length} sources
                        <ChevronDown
                          className={`w-3 h-3 transition ${
                            openSources === i ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {openSources === i && (
                        <ul className="mt-2 space-y-2">
                          {msg.sources.map((src) => (
                            <li
                              key={src.id}
                              className="text-xs text-slate-600 bg-slate-50 border rounded-lg p-2"
                            >
                              {src.type === "web" ? (
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-semibold text-emerald-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <Globe className="w-3 h-3" />[{src.id}]{" "}
                                  {src.title || src.url}
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() =>
                                      setViewerPage(
                                        Number(src.page) > 0 ? Number(src.page) : 1
                                      )
                                    }
                                    title="Open this page in the document"
                                    className="font-semibold text-blue-600 hover:underline"
                                  >
                                    [{src.id}] Page {src.page}
                                  </button>
                                  {typeof src.relevance === "number" && (
                                    <span
                                      title="Cross-encoder relevance score"
                                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700"
                                    >
                                      {src.relevance}% match
                                    </span>
                                  )}
                                </span>
                              )}{" "}
                              — {src.snippet}


                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="relative p-4 border-t bg-white">
        {showScrollDown && (
          <button
            onClick={() =>
              bottomRef.current?.scrollIntoView({ behavior: "smooth" })
            }
            className="absolute -top-12 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white border shadow-md flex items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-400 transition"
            title="Scroll to latest"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={!selectedPdfId}
            placeholder={
              selectedPdfId ? "Ask about your document..." : "Select a PDF first"
            }
            className="flex-1 border rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          />
          {loading ? (
            <button
              onClick={stop}
              className="w-11 h-11 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-slate-700 transition"
              title="Stop generating"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={() => send()}
              disabled={!message.trim() || !selectedPdfId}
              className="w-11 h-11 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:bg-slate-300"
            >
              <SendHorizonal className="w-5 h-5" />
            </button>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-2">
          AI can search your document and the web. Please verify important
          information.
        </p>
      </div>

      {viewerPage !== null && selectedPdfId && (
        <PdfViewer
          pdfId={selectedPdfId}
          page={viewerPage}
          name={selectedPdf?.name}
          onClose={() => setViewerPage(null)}
        />
      )}
    </div>
  );
}


