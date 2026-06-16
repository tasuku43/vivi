import { useEffect, useId, useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
import { pathlensMermaidThemeVariables } from "../../domain/mermaid-theme.js";
import { hasCustomMermaidStyle } from "../../domain/mermaid-preview.js";
import {
  lineRangeForQuote,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentDraft,
} from "../state/comments.js";
import type { ResolvedTheme } from "../state/theme.js";
import { SelectionCommentPopover } from "../components/SelectionCommentPopover.js";
import { DiffViewer } from "./DiffViewer.js";

export { hasCustomMermaidStyle } from "../../domain/mermaid-preview.js";

type MermaidRenderStatus = "loading" | "rendered" | "fallback" | "error";

export function MermaidViewer({
  file,
  theme = "dark",
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
}: {
  file: FilePayload;
  theme?: ResolvedTheme;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: (draft: CommentDraft) => void;
}) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    left: number;
    top: number;
  } | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const { containerRef, error, status } = useMermaidRender(
    file.content,
    `${useId()}-${slugForMarker(file.path)}`,
    theme,
  );
  const updateSourceSelectionComment = () => {
    const selection = selectionCommentTargetInElement(sourceRef.current);
    if (!selection) {
      setSelectionComment(null);
      return;
    }
    setSelectionComment({
      draft: sourceCommentDraft(
        file,
        lineRangeForQuote(file.content, selection.text),
        selection.text,
      ),
      left: selection.rect.left + selection.rect.width / 2,
      top: selection.rect.top,
    });
  };

  return (
    <section className="mermaid-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          Mermaid preview · strict security
        </span>
        <button
          aria-pressed={Boolean(diffEnabled)}
          className={`diff-toggle${diffEnabled ? " active" : ""}`}
          type="button"
          onClick={onDiffToggle}
        >
          Diff from HEAD
        </button>
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
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          focusChanges={diffFocusChanges}
          renderKind="source"
          theme={theme}
          onFocusChangesChange={onDiffFocusChange}
          file={file}
          onCreateComment={onCreateComment}
        />
      ) : mode === "preview" ? (
        <div className="mermaid-render-surface">
          <div
            className={`mermaid-render-target ${status}`}
            ref={containerRef}
          />
          {status === "loading" ? (
            <p className="muted">Rendering Mermaid diagram...</p>
          ) : null}
          {status === "error" ? (
            <div className="unsupported">
              <h2>{file.path}</h2>
              <p>{error ?? "Mermaid could not render this diagram."}</p>
            </div>
          ) : null}
          {status === "fallback" ? (
            <div className="unsupported">
              <h2>{file.path}</h2>
              <p>
                Mermaid could not render this diagram. The source view is still
                available.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <pre
          className="markdown-source"
          ref={sourceRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSourceSelectionComment)
          }
          onKeyUp={updateSourceSelectionComment}
        >
          {file.content}
        </pre>
      )}
      <SelectionCommentPopover
        draft={selectionComment?.draft ?? null}
        left={selectionComment?.left ?? 0}
        top={selectionComment?.top ?? 0}
        onCreateComment={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
    </section>
  );
}

export function useMermaidRender(
  source: string,
  id: string,
  theme: ResolvedTheme,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<MermaidRenderStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    setStatus("loading");
    setError(null);
    container.replaceChildren();

    renderMermaidSvg(source, `${id}-${hashString(source)}`, theme)
      .then((svg) => {
        if (cancelled) return;
        container.innerHTML = svg;
        setStatus("rendered");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(errorMessage(err));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [id, source, theme]);

  return { containerRef, error, status };
}

export async function renderMermaidSvg(
  source: string,
  id: string,
  theme: ResolvedTheme,
): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: hasCustomMermaidStyle(source)
      ? theme === "dark"
        ? "dark"
        : "default"
      : "base",
    themeVariables: hasCustomMermaidStyle(source)
      ? undefined
      : pathlensMermaidThemeVariables(theme),
    flowchart: {
      htmlLabels: false,
    },
  });
  const { svg } = await mermaid.render(`pathlens-${slugForMarker(id)}`, source);
  return sanitizeMermaidSvg(svg);
}

export function renderMermaidBlocks(
  root: HTMLElement,
  theme: ResolvedTheme,
): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("[data-mermaid-source]"),
  );

  for (const [index, block] of blocks.entries()) {
    const source = block.dataset.mermaidSource;
    const target = block.querySelector<HTMLElement>(".mermaid-render-target");
    if (!source || !target) continue;
    if (block.dataset.mermaidStatus === "loading") continue;
    if (
      block.dataset.mermaidStatus === "rendered" &&
      block.dataset.mermaidTheme === theme
    ) {
      continue;
    }

    block.dataset.mermaidStatus = "loading";
    block.dataset.mermaidTheme = theme;
    target.replaceChildren();
    renderMermaidSvg(
      source,
      `${block.id || "markdown-mermaid"}-${index}-${hashString(source)}`,
      theme,
    )
      .then((svg) => {
        target.innerHTML = svg;
        block.dataset.mermaidStatus = "rendered";
      })
      .catch(() => {
        block.dataset.mermaidStatus = "fallback";
      });
  }
}

function slugForMarker(value: string): string {
  const slug = value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  return slug || "diagram";
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Mermaid could not render this diagram.";
}

function sanitizeMermaidSvg(svg: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, "image/svg+xml");
  for (const node of Array.from(document.querySelectorAll("script"))) {
    node.remove();
  }
  for (const node of Array.from(document.querySelectorAll("foreignObject"))) {
    node.remove();
  }
  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith("on")) element.removeAttribute(attribute.name);
      if (
        (name === "href" || name.endsWith(":href")) &&
        value.startsWith("javascript:")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}
