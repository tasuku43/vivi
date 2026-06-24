import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import {
  currentScopeForLine,
  detectCodeSymbols,
  formatLineReference,
  formatSelectedCodeWithLineNumbers,
  normalizeLineRange,
  splitCodeLines,
  type LineRange,
} from "../../../state/code-viewer.js";
import {
  type CommentCreateHandler,
  type CommentStatusChangeHandler,
} from "../../../state/comments.js";
import { languageForPath } from "../../../state/file-icons.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { SourceCommentSurface } from "../../comments/components/SourceCommentSurface.js";
import {
  DiffToggleButton,
  ViewerToolbar,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";

export function CodeViewer({
  file,
  theme,
  selectedRange,
  focusLineNumber,
  focusRevision,
  toolbarAction,
  refreshedAt,
  diff,
  diffLoading,
  diffEnabled,
  onSelectionChange,
  onDiffToggle,
  onCreateComment,
  comments = [],
  activeCommentId,
  expandActiveCommentThread = true,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
}: {
  file: FilePayload;
  theme: ResolvedTheme;
  selectedRange: LineRange | null;
  focusLineNumber?: number | null;
  focusRevision?: number;
  toolbarAction?: ReactNode;
  refreshedAt?: number;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  onSelectionChange: (range: LineRange | null) => void;
  onDiffToggle?: () => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread?: boolean;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  const [highlightedHtml, setHighlightedHtml] = useState<{
    content: string;
    language: string;
    theme: ResolvedTheme;
    html: string;
  } | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const language = languageForPath(file.path, file.viewerKind);
  const lines = splitCodeLines(file.content);
  const html =
    highlightedHtml?.content === file.content &&
    highlightedHtml.language === language &&
    highlightedHtml.theme === theme
      ? highlightedHtml.html
      : null;
  const highlightedLines = useMemo(
    () => (html ? extractHighlightedLines(html) : null),
    [html],
  );
  const symbols = detectCodeSymbols(file.path, file.content);
  const selected = selectedRange
    ? normalizeLineRange(selectedRange.start, selectedRange.end, lines.length)
    : null;
  const currentScope = currentScopeForLine(symbols, selected?.start ?? 1);

  useEffect(() => {
    let cancelled = false;
    import("../../../state/highlighter.js")
      .then(({ highlightCode }) => highlightCode(file.content, language, theme))
      .then((highlighted) => {
        if (!cancelled) {
          setHighlightedHtml({
            content: file.content,
            language,
            theme,
            html: highlighted,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.content, language, theme]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(label);
      window.setTimeout(() => setCopyStatus(null), 1600);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  return (
    <section className="code-pro" aria-label={`Code viewer for ${file.path}`}>
      <ViewerToolbar
        actionsClassName="code-pro-actions"
        ariaLabel={`Code viewer controls for ${file.path}`}
        status={
          <>
            {refreshedAt ? (
              <span className="refresh-pill">
                refreshed {new Date(refreshedAt).toLocaleTimeString()}
              </span>
            ) : selected ? (
              `Lines ${selected.start}-${selected.end} selected`
            ) : (
              "Read-only"
            )}
            {copyStatus ? (
              <span className="copy-status">{copyStatus}</span>
            ) : null}
          </>
        }
      >
        {selected ? (
          <>
            <button
              type="button"
              onClick={() =>
                void copyText(
                  formatLineReference(file.path, selected),
                  "Reference copied",
                )
              }
            >
              Copy ref
            </button>
            <button
              type="button"
              onClick={() =>
                void copyText(
                  formatSelectedCodeWithLineNumbers(
                    file.path,
                    file.content,
                    selected,
                  ),
                  "Code copied",
                )
              }
            >
              Copy range
            </button>
            <button
              type="button"
              onClick={() => {
                onSelectionChange(null);
                onCloseComment?.();
              }}
            >
              Clear
            </button>
          </>
        ) : null}
        {toolbarAction}
        <DiffToggleButton
          enabled={diffEnabled}
          path={file.path}
          onToggle={onDiffToggle}
        />
      </ViewerToolbar>
      <div className="code-scope-bar">
        <span>Current scope</span>
        <strong>
          {currentScope
            ? `${currentScope.kind} ${currentScope.name} · line ${currentScope.line}`
            : "Top of file"}
        </strong>
      </div>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          renderKind="source"
          file={file}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          expandActiveCommentThread={expandActiveCommentThread}
          onOpenComment={onOpenComment}
          threadActivities={threadActivities}
        />
      ) : (
        <SourceCommentSurface
          file={file}
          highlightedLines={highlightedLines}
          selectedRange={selectedRange}
          focusLineNumber={focusLineNumber}
          focusRevision={focusRevision}
          comments={comments}
          activeCommentId={activeCommentId}
          expandActiveCommentThread={expandActiveCommentThread}
          onSelectionChange={onSelectionChange}
          onCreateComment={onCreateComment}
          onOpenComment={onOpenComment}
          onCloseComment={onCloseComment}
          onCommentStatusChange={onCommentStatusChange}
          threadActivities={threadActivities}
        />
      )}
    </section>
  );
}

interface DOMRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function extractHighlightedLines(html: string): string[] {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    const lineNodes = [...document.querySelectorAll("span.line")];
    if (lineNodes.length) return lineNodes.map((line) => line.innerHTML || " ");
  }
  const code = /<code[^>]*>([\s\S]*?)<\/code>/i.exec(html)?.[1] ?? html;
  const lineMatches = extractLineSpanContents(code);
  if (lineMatches.length) return lineMatches.map((line) => line || " ");
  return code.split(/\r?\n/).map((line) => line || " ");
}

function extractLineSpanContents(code: string): string[] {
  const lines: string[] = [];
  const openMarker = '<span class="line">';
  let index = 0;
  while (index < code.length) {
    const start = code.indexOf(openMarker, index);
    if (start < 0) break;
    let cursor = start + openMarker.length;
    let depth = 1;
    while (cursor < code.length && depth > 0) {
      const nextOpen = code.indexOf("<span", cursor);
      const nextClose = code.indexOf("</span>", cursor);
      if (nextClose < 0) break;
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + 5;
      } else {
        depth -= 1;
        if (depth === 0) {
          lines.push(code.slice(start + openMarker.length, nextClose));
          cursor = nextClose + "</span>".length;
          break;
        }
        cursor = nextClose + "</span>".length;
      }
    }
    index = cursor;
  }
  return lines;
}
