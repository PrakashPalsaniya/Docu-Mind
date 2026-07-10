import { useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Search,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";
import { api } from "../lib/api";

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "READY", label: "Ready" },
  { key: "PROCESSING", label: "Processing" },
  { key: "FAILED", label: "Failed" },
];


function StatusIcon({ status }) {
  if (status === "READY")
    return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (status === "FAILED")
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
}

export default function FileUpload({
  pdfs,
  selectedPdfId,
  onSelect,
  onUploaded,
  onDeleted,
}) {
  const { getToken } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const inputRef = useRef(null);



  const counts = useMemo(() => {
    const c = { ALL: pdfs.length, READY: 0, PROCESSING: 0, FAILED: 0 };
    for (const p of pdfs) if (c[p.status] !== undefined) c[p.status] += 1;
    return c;
  }, [pdfs]);

  const visiblePdfs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pdfs.filter((p) => {
      const statusOk = filter === "ALL" || p.status === filter;
      const nameOk = !q || p.name.toLowerCase().includes(q);
      return statusOk && nameOk;
    });
  }, [pdfs, filter, query]);


  const handleDelete = async (pdf) => {
    try {
      setDeletingId(pdf.id);
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await api.deletePdf(token, pdf.id);
      toast.success(`"${pdf.name}" deleted.`);
      onDeleted?.(pdf.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeletingId(null);
      setConfirmTarget(null);
    }
  };


  const upload = async (file) => {

    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file.");
      return;
    }
    try {
      setUploading(true);
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await api.uploadPdf(token, file);
      toast.success("PDF uploaded. Processing started.");
      onUploaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 h-full">
      <h3 className="text-lg font-bold">Your Documents</h3>

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) upload(file);
        }}
        className="border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center gap-2 py-8 px-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition"
      >
        <input
          type="file"
          ref={inputRef}
          className="hidden"
          accept="application/pdf"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload(file);
          }}
        />
        {uploading ? (
          <Loader2 className="w-7 h-7 text-blue-500 animate-spin" />
        ) : (
          <UploadCloud className="w-7 h-7 text-slate-400" />
        )}
        <p className="text-sm font-medium">Drop PDF or click</p>
        <p className="text-xs text-slate-400">Max 15MB</p>
      </div>

      {pdfs.length > 0 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents…"
            className="w-full text-xs rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 focus:outline-none focus:border-blue-400"
          />
        </div>
      )}

      {pdfs.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[11px] font-medium rounded-full px-2.5 py-1 border transition ${
                filter === f.key
                  ? "bg-blue-600 border-blue-600 text-white"
                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {f.label} ({counts[f.key] ?? 0})
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {pdfs.length === 0 && (
          <p className="text-xs text-slate-400">No PDFs yet.</p>
        )}
        {pdfs.length > 0 && visiblePdfs.length === 0 && (
          <p className="text-xs text-slate-400">No documents match this filter.</p>
        )}
        {visiblePdfs.map((pdf) => (
          <div
            key={pdf.id}
            className={`group relative flex flex-col gap-1 p-3 rounded-lg border transition ${
              selectedPdfId === pdf.id
                ? "border-blue-500 bg-blue-50"
                : pdf.status === "FAILED"
                ? "border-red-200 bg-red-50/50"
                : "border-slate-200 bg-white hover:bg-slate-50"
            }`}
          >
            <button
              type="button"
              onClick={() => pdf.status === "READY" && onSelect(pdf.id)}
              disabled={pdf.status !== "READY"}
              title={
                pdf.status === "FAILED"
                  ? pdf.statusMessage || "Processing failed"
                  : undefined
              }
              className={`flex flex-col gap-1 text-left w-full ${
                pdf.status !== "READY" ? "cursor-not-allowed" : ""
              }`}
            >
              <div className="flex items-center gap-3 w-full pr-6">
                <FileText
                  className={`w-4 h-4 shrink-0 ${
                    pdf.status === "FAILED" ? "text-red-400" : "text-blue-500"
                  }`}
                />
                <span className="flex-1 text-xs font-medium truncate">
                  {pdf.name}
                </span>
                <StatusIcon status={pdf.status} />
              </div>

              {pdf.status === "PROCESSING" && (
                <span className="text-[10px] text-blue-500 pl-7">
                  Processing… you can keep chatting with other documents.
                </span>
              )}
              {pdf.status === "FAILED" && (
                <span className="text-[10px] text-red-500 pl-7 line-clamp-2">
                  {pdf.statusMessage || "Processing failed. Please try again."}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setConfirmTarget(pdf)}
              disabled={deletingId === pdf.id}
              title="Delete document"

              className="absolute top-2 right-2 p-1 rounded-md text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-100"
            >
              {deletingId === pdf.id ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        ))}


      </div>

      {confirmTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => deletingId === null && setConfirmTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-full">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <h4 className="text-base font-semibold text-slate-800">
                Delete document
              </h4>
            </div>

            <p className="mt-3 text-sm text-slate-500">
              Are you sure? This can’t be undone.
            </p>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                disabled={deletingId !== null}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmTarget)}
                disabled={deletingId !== null}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-70 flex items-center gap-2"
              >
                {deletingId !== null && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
