import { marked } from "marked";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  extractMarkdownOutline,
  renderMarkdownHtmlWithHeadingIds,
} from "../state/outline.js";

export function MarkdownViewer({ file }: { file: FilePayload }) {
  const html = renderMarkdownHtmlWithHeadingIds(
    marked.parse(file.content) as string,
    extractMarkdownOutline(file.content),
  );
  return (
    <article className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
