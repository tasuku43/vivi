export type ViewerKind =
  | "markdown"
  | "html"
  | "code"
  | "text"
  | "image"
  | "json"
  | "mermaid"
  | "binary"
  | "unsupported";

const markdownExtensions = new Set([".md", ".markdown", ".mdown"]);
const htmlExtensions = new Set([".html", ".htm"]);
const imageExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);
const jsonExtensions = new Set([".json", ".jsonc"]);
const mermaidExtensions = new Set([".mmd", ".mermaid"]);
const textExtensions = new Set([".txt", ".log", ".csv", ".tsv"]);
const binaryExtensions = new Set([
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".wasm",
  ".sqlite",
  ".db",
  ".bin",
  ".exe",
  ".dmg",
  ".mp3",
  ".mp4",
  ".mov",
]);
const codeBasenames = new Set(["dockerfile"]);
const codeExtensions = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".scss",
  ".go",
  ".rs",
  ".py",
  ".rb",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".zsh",
  ".bash",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".sql",
]);

export function classifyViewer(path: string): ViewerKind {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const extension = lower.includes(".")
    ? lower.slice(lower.lastIndexOf("."))
    : "";
  if (markdownExtensions.has(extension)) return "markdown";
  if (htmlExtensions.has(extension)) return "html";
  if (imageExtensions.has(extension)) return "image";
  if (jsonExtensions.has(extension)) return "json";
  if (mermaidExtensions.has(extension)) return "mermaid";
  if (textExtensions.has(extension)) return "text";
  if (binaryExtensions.has(extension)) return "binary";
  if (codeBasenames.has(basename)) return "code";
  if (codeExtensions.has(extension)) return "code";
  return "unsupported";
}
