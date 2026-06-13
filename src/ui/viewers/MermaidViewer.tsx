import { useState } from "react";
import type { FilePayload } from "../../domain/fs-node.js";

interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
}

interface MermaidRenderOptions {
  idPrefix?: string;
  title?: string;
}

export function MermaidViewer({ file }: { file: FilePayload }) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const edges = parseMermaidEdges(file.content);

  return (
    <section className="mermaid-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          Safe Mermaid preview · scripts inactive
        </span>
        <div className="segmented-control" aria-label="Mermaid view mode">
          <button
            className={mode === "preview" ? "active" : ""}
            type="button"
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
          <button
            className={mode === "source" ? "active" : ""}
            type="button"
            onClick={() => setMode("source")}
          >
            Source
          </button>
        </div>
      </div>
      {mode === "preview" && edges.length ? (
        <div
          dangerouslySetInnerHTML={{
            __html: renderMermaidPreviewHtml(file.content, {
              idPrefix: `pathlens-${slugForMarker(file.path)}`,
              title: file.path,
            }),
          }}
        />
      ) : mode === "preview" ? (
        <div className="unsupported">
          <h2>{file.path}</h2>
          <p>
            This Mermaid file is readable as source, but the lightweight preview
            only supports simple flowchart arrows.
          </p>
        </div>
      ) : (
        <pre className="markdown-source">{file.content}</pre>
      )}
    </section>
  );
}

export function parseMermaidEdges(content: string): MermaidEdge[] {
  const lines = content.split(/\r?\n/);
  const firstMeaningfulLine = lines.find((line) => line.trim());
  if (
    !firstMeaningfulLine ||
    !/^(graph|flowchart)\b/i.test(firstMeaningfulLine.trim())
  )
    return [];

  return lines
    .flatMap((line) => {
      const normalized = line.trim().replace(/;$/, "");
      if (!normalized || /^(graph|flowchart)\b/i.test(normalized)) return [];
      const match = /^(.+?)\s*-{1,2}>(?:\|(.+?)\|)?\s*(.+)$/.exec(normalized);
      if (!match) return [];
      return [
        {
          from: cleanMermaidNode(match[1]),
          label: match[2]?.trim(),
          to: cleanMermaidNode(match[3]),
        },
      ];
    })
    .filter((edge) => edge.from && edge.to);
}

export function renderMermaidPreviewHtml(
  content: string,
  options: MermaidRenderOptions = {},
): string {
  const edges = parseMermaidEdges(content);
  if (!edges.length) return "";
  const nodes = [...new Set(edges.flatMap((edge) => [edge.from, edge.to]))];
  const markerId = `${options.idPrefix ?? "pathlens-mermaid"}-arrow`;
  const height = Math.max(180, nodes.length * 82);
  const title = escapeHtml(options.title ?? "Mermaid preview");
  const edgeHtml = edges
    .map((edge, index) => {
      const fromIndex = nodes.indexOf(edge.from);
      const toIndex = nodes.indexOf(edge.to);
      const y1 = 48 + fromIndex * 78;
      const y2 = 48 + toIndex * 78;
      const midY = (y1 + y2) / 2;
      const label = edge.label
        ? `<text class="mermaid-label" x="382" y="${midY - 6}">${escapeHtml(edge.label)}</text>`
        : "";
      return `<g data-edge="${index}"><path class="mermaid-edge" marker-end="url(#${markerId})" d="M250 ${y1} C390 ${y1}, 390 ${y2}, 510 ${y2}"></path>${label}</g>`;
    })
    .join("");
  const nodeHtml = nodes
    .map((node, index) => {
      const y = 28 + index * 78;
      return `<g class="mermaid-node"><rect x="38" y="${y}" width="210" height="42" rx="8"></rect><text x="58" y="${y + 27}">${escapeHtml(node)}</text></g>`;
    })
    .join("");

  return `<div class="mermaid-stage"><svg class="mermaid-svg" role="img" aria-label="${title}" viewBox="0 0 760 ${height}"><defs><marker id="${markerId}" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4"><path d="M0,0 L8,4 L0,8 Z"></path></marker></defs>${edgeHtml}${nodeHtml}</svg></div>`;
}

function cleanMermaidNode(value: string): string {
  return value
    .trim()
    .replace(/^[A-Za-z0-9_]+\[/, "")
    .replace(/\]$/, "")
    .replace(/^["']|["']$/g, "");
}

function slugForMarker(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
