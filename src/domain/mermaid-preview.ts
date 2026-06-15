export function hasCustomMermaidStyle(content: string): boolean {
  return content.split(/\r?\n/).some((line) => {
    const normalized = line.trim();
    return (
      /^%%\s*\{\s*init\s*:/i.test(normalized) ||
      /^---/.test(normalized) ||
      /^classDef\b/i.test(normalized) ||
      /^class\s+[A-Za-z0-9_,]+\s+[A-Za-z0-9_-]+\s*;?$/i.test(normalized) ||
      /^style\s+[A-Za-z0-9_]+\s+.+/i.test(normalized) ||
      /^linkStyle\s+\d+\s+.+/i.test(normalized) ||
      /^theme\b/i.test(normalized) ||
      /^themeVariables\b/i.test(normalized)
    );
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
