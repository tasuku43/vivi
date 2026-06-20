import type { ViewerKind } from "../domain/viewer-kind.js";

export function iconForPath(
  path: string,
  viewerKind?: ViewerKind | string,
): string {
  const lower = path.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;
  const extension = lower.split(".").pop() ?? "";
  if (viewerKind === "markdown" || extension === "md") return "📘";
  if (viewerKind === "html" || extension === "html" || extension === "htm")
    return "🌐";
  if (
    viewerKind === "image" ||
    ["gif", "jpg", "jpeg", "png", "svg", "webp"].includes(extension)
  )
    return "🖼️";
  if (viewerKind === "json" || extension === "json") return "{}";
  if (viewerKind === "mermaid") return "MRM";
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
  const filenameLanguages: Record<string, string> = {
    ".clang-format": "yaml",
    ".clippy.toml": "toml",
    ".cocciconfig": "ini",
    ".dockerignore": "text",
    ".editorconfig": "ini",
    ".gitattributes": "text",
    ".gitignore": "text",
    ".get_maintainer.ignore": "text",
    ".kunitconfig": "text",
    ".mailmap": "text",
    ".pylintrc": "ini",
    ".renames.txt": "text",
    ".rustfmt.toml": "toml",
    dockerfile: "dockerfile",
    license: "text",
    kbuild: "makefile",
    kconfig: "text",
    makefile: "makefile",
    "go.mod": "text",
    "go.sum": "text",
  };
  if (filenameLanguages[basename]) return filenameLanguages[basename];
  if (/^dockerfile[._-]/.test(basename)) return "dockerfile";
  if (/^kconfig[._-]/.test(basename)) return "text";
  if (/^makefile[._-]/.test(basename)) return "makefile";

  const extension = lower.split(".").pop() ?? "";
  const languages: Record<string, string> = {
    asm: "asm",
    awk: "awk",
    bash: "bash",
    c: "c",
    cc: "cpp",
    cfg: "ini",
    conf: "ini",
    cjs: "javascript",
    cpp: "cpp",
    cts: "typescript",
    css: "css",
    csv: "csv",
    diff: "diff",
    dts: "text",
    dtsi: "text",
    go: "go",
    h: "c",
    hh: "cpp",
    hpp: "cpp",
    htm: "html",
    html: "html",
    ini: "ini",
    java: "java",
    js: "javascript",
    json: "json",
    jsonc: "jsonc",
    jsx: "jsx",
    kt: "kotlin",
    kts: "kotlin",
    log: "log",
    lua: "lua",
    make: "makefile",
    md: "markdown",
    mermaid: "mermaid",
    mmd: "mermaid",
    mjs: "javascript",
    mts: "typescript",
    patch: "diff",
    perl: "perl",
    php: "php",
    pl: "perl",
    pm: "perl",
    properties: "properties",
    py: "python",
    rb: "ruby",
    rs: "rust",
    s: "asm",
    scss: "scss",
    sed: "text",
    sh: "bash",
    sql: "sql",
    toml: "toml",
    svg: "xml",
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
