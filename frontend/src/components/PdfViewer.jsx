import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { X, Loader2, FileText } from "lucide-react";
import { api } from "../lib/api";

// Full-screen modal that streams the authed PDF into an <iframe> at a given page.
export default function PdfViewer({ pdfId, page, name, onClose }) {
  const { getToken } = useAuth();
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        objectUrl = await api.pdfFileUrl(token, pdfId);
        if (!cancelled) setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to load PDF");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfId, getToken]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = url ? `${url}#page=${page || 1}&view=FitH` : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="text-sm font-medium text-slate-700 truncate">
              {name || "Document"}
            </span>
            {page && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 shrink-0">
                Page {page}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 bg-slate-100">
          {error ? (
            <div className="h-full flex items-center justify-center text-sm text-red-500">
              {error}
            </div>
          ) : src ? (
            <iframe title="PDF preview" src={src} className="w-full h-full" />
          ) : (
            <div className="h-full flex items-center justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
