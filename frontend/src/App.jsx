import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  SignedIn,
  SignedOut,
  SignIn,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import {
  FileText,
  Loader2,
  Search,
  Globe,
  Zap,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import FileUpload from "./components/FileUpload";
import ChatArea from "./components/ChatArea";
import Logo from "./components/Logo";
import Wordmark from "./components/Wordmark";

import { api } from "./lib/api";

function LoadingOverlay({ title, subtitle }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-5">
        <div className="relative w-20 h-20">
          <span className="absolute inset-0 rounded-full bg-blue-400/30 animate-ping" />
          <span className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-500 border-r-indigo-500 animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <FileText className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="text-center">
          <p className="font-semibold text-slate-700 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            {title}
          </p>
          <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function Workspace() {
  const { getToken } = useAuth();
  const [pdfs, setPdfs] = useState([]);
  const [selectedPdfId, setSelectedPdfId] = useState(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const prevStatusRef = useRef({}); // last-seen status per PDF, for transition toasts

  const refreshPdfs = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const { pdfs } = await api.listPdfs(token);

      const prev = prevStatusRef.current;
      const next = {};
      for (const p of pdfs) {
        next[p.id] = p.status;
        const was = prev[p.id];
        if (was && was !== p.status) {
          if (p.status === "READY") {
            toast.success(`"${p.name}" is ready to chat.`);
          } else if (p.status === "FAILED") {
            toast.error(
              `"${p.name}" failed: ${p.statusMessage || "processing error"}`
            );
          }
        }
      }
      prevStatusRef.current = next;

      setPdfs(pdfs);
      setSelectedPdfId(
        (prev) => prev ?? pdfs.find((p) => p.status === "READY")?.id ?? null
      );
    } finally {
      setInitialLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    refreshPdfs();
    const interval = setInterval(refreshPdfs, 4000);
    return () => clearInterval(interval);
  }, [refreshPdfs]);

  const handleDeleted = useCallback(
    (deletedId) => {
      setPdfs((cur) => cur.filter((p) => p.id !== deletedId));
      setSelectedPdfId((cur) => (cur === deletedId ? null : cur));
      delete prevStatusRef.current[deletedId];
      refreshPdfs();
    },
    [refreshPdfs]
  );

  const selectedPdf = pdfs.find((p) => p.id === selectedPdfId) || null;
  const processingCount = pdfs.filter((p) => p.status === "PROCESSING").length;

  return (
    <div className="h-screen flex flex-col">
      {initialLoading && (
        <LoadingOverlay
          title="Loading your documents…"
          subtitle="Just a moment"
        />
      )}

      <header className="flex items-center justify-between px-6 py-3 border-b bg-white">
        <div className="flex items-center gap-2">
          <Logo className="w-9 h-9 drop-shadow-sm" />
          <Wordmark className="text-lg" />
          <span className="text-[10px] font-medium text-slate-400 border border-slate-200 rounded-full px-2 py-0.5">
            Agentic PDF Intelligence
          </span>

          {processingCount > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2.5 py-0.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Processing {processingCount}
            </span>
          )}
        </div>


        <UserButton />
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[340px] border-r bg-slate-50 p-4 overflow-y-auto hidden md:block">
          <FileUpload
            pdfs={pdfs}
            selectedPdfId={selectedPdfId}
            onSelect={setSelectedPdfId}
            onUploaded={refreshPdfs}
            onDeleted={handleDeleted}
          />

        </aside>
        <main className="flex-1 overflow-hidden">
          <ChatArea selectedPdfId={selectedPdfId} selectedPdf={selectedPdf} />
        </main>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: Search,
    title: "Agentic RAG",
    desc: "Hybrid search + reranking finds the exact passages that answer you.",
  },
  {
    icon: Globe,
    title: "Web fallback",
    desc: "Not in the PDF? It automatically searches the web and cites sources.",
  },
  {
    icon: Zap,
    title: "Semantic cache",
    desc: "Repeat questions return instantly — no redundant LLM calls.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    desc: "Embeddings run locally. Your documents stay yours.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:flex flex-col justify-between p-12 bg-gradient-to-br from-slate-950 via-indigo-950 to-blue-950 text-white overflow-hidden">
        {/* ambient glow blobs */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -left-24 w-80 h-80 bg-violet-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 right-1/4 w-96 h-96 bg-indigo-400/10 rounded-full blur-3xl" />
        {/* subtle grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <div className="relative flex items-center gap-2.5">
          <div className="p-1.5 bg-white/10 backdrop-blur rounded-xl ring-1 ring-white/20">
            <Logo className="w-8 h-8" variant="plain-white" />
          </div>
          <Wordmark className="text-xl" variant="white" />
        </div>

        <div className="relative">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-200 bg-white/5 border border-white/15 rounded-full px-3 py-1 backdrop-blur">
            <Sparkles className="w-3.5 h-3.5" />
            Agentic PDF Intelligence
          </span>

          <h1 className="mt-5 text-5xl font-extrabold leading-[1.1] tracking-tight">
            Chat with any PDF,
            <br />
            powered by{" "}
            <span className="bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
              agentic RAG
            </span>
            .
          </h1>

          <p className="mt-5 text-white/70 max-w-md leading-relaxed">
            Upload a document and get precise, cited answers.{" "}
            <Wordmark className="text-base align-baseline" variant="white" />{" "}
            reasons over your files, falls back to the web, and remembers what
            it's already answered.
          </p>

          <div className="mt-9 grid sm:grid-cols-2 gap-3 max-w-lg">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group flex gap-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 backdrop-blur rounded-xl p-4 transition"
              >
                <div className="p-2 h-fit rounded-lg bg-gradient-to-br from-blue-500/20 to-violet-500/20 ring-1 ring-white/10">
                  <f.icon className="w-4 h-4 text-blue-300" />
                </div>
                <div>
                  <p className="font-semibold text-sm">{f.title}</p>
                  <p className="text-xs text-white/60 mt-0.5 leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-white/40">
          Built with LangGraph · Qdrant · Local embeddings
        </p>
      </div>

      <div className="relative flex flex-col items-center justify-center p-8 bg-slate-50">
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <Logo className="w-10 h-10 drop-shadow-sm" />
          <Wordmark className="text-xl" />
        </div>

        <div className="w-full max-w-sm">
          <div className="hidden lg:block mb-6 text-center">
            <h2 className="text-2xl font-bold text-slate-800">
              Welcome to <Wordmark className="text-2xl align-baseline" />
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Sign in to start chatting with your documents.
            </p>
          </div>
          <div className="flex justify-center">
            <SignIn />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <SignedOut>
        <Landing />
      </SignedOut>
      <SignedIn>
        <Workspace />
      </SignedIn>
    </>
  );
}


