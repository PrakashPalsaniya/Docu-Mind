// Stylish "DocuMind" wordmark: "Docu" in solid ink, "Mind" in a gradient.
// variant: "gradient" (default, for light bg) or "white" (for dark bg).
export default function Wordmark({ className = "text-lg", variant = "gradient" }) {
  const docu = variant === "white" ? "text-white" : "text-slate-800";
  const mind =
    variant === "white"
      ? "text-white/90"
      : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent";

  return (
    <span
      className={`font-extrabold tracking-tight select-none ${className}`}
    >
      <span className={docu}>Docu</span>
      <span className={mind}>Mind</span>
    </span>
  );
}
