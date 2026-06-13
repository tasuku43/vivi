import type { ViewerKind } from "../../domain/viewer-kind.js";

export function iconForPath(
  path: string,
  viewerKind?: ViewerKind | string,
): string {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const extension = lower.split(".").pop() ?? "";
  if (viewerKind === "markdown") return "📘";
  if (viewerKind === "html") return "🌐";
  if (viewerKind === "image") return "🖼️";
  if (viewerKind === "json") return "{}";
  if (basename === "dockerfile") return "DOCK";
  if (extension === "yml" || extension === "yaml") return "YAML";
  if (extension === "ts" || extension === "tsx") return "TS";
  if (extension === "js" || extension === "jsx") return "JS";
  if (extension === "css" || extension === "scss") return "CSS";
  if (extension === "go") return "GO";
  if (extension === "rs") return "RS";
  if (extension === "py") return "PY";
  if (viewerKind === "code") return "<>";
  if (viewerKind === "text") return "TXT";
  return "FILE";
}

export function languageForPath(
  path: string,
  viewerKind?: ViewerKind | string,
): string {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  if (basename === "dockerfile") return "dockerfile";

  const extension = lower.split(".").pop() ?? "";
  const languages: Record<string, string> = {
    bash: "bash",
    c: "c",
    cpp: "cpp",
    css: "css",
    csv: "csv",
    go: "go",
    h: "c",
    hpp: "cpp",
    html: "html",
    java: "java",
    js: "javascript",
    json: "json",
    jsonc: "jsonc",
    jsx: "jsx",
    kt: "kotlin",
    log: "log",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    scss: "scss",
    sh: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "tsx",
    txt: "text",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    zsh: "bash",
  };
  return languages[extension] ?? (viewerKind === "json" ? "json" : "text");
}
