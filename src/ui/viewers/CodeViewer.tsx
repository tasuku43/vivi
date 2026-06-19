import { useEffect, useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { ViviComment } from "../../domain/comments.js";
import type { FilePayload } from "../../domain/fs-node.js";
import {
  currentScopeForLine,
  detectCodeSymbols,
  formatLineReference,
  formatSelectedCodeWithLineNumbers,
  lineInRange,
  normalizeLineRange,
  splitCodeLines,
  type LineRange,
} from "../state/code-viewer.js";
import {
  commentsForLine,
  lineRangeForQuote,
  rectLikeFromElement,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  sourceLineCommentDraft,
  type CommentCreateHandler,
  type CommentDraft,
} from "../state/comments.js";
import { iconForPath, languageForPath } from "../state/file-icons.js";
import type { ResolvedTheme } from "../state/theme.js";
import { SelectionCommentComposer } from "../components/SelectionCommentComposer.js";
import { DiffViewer } from "./DiffViewer.js";

export function CodeViewer({
  file,
  theme,
  selectedRange,
  refreshedAt,
  diff,
  diffLoading,
  diffEnabled,
  diffFocusChanges,
  onSelectionChange,
  onDiffToggle,
  onDiffFocusChange,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  file: FilePayload;
  theme: ResolvedTheme;
  selectedRange: LineRange | null;
  refreshedAt?: number;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  diffFocusChanges?: boolean;
  onSelectionChange: (range: LineRange | null) => void;
  onDiffToggle?: () => void;
  onDiffFocusChange?: (focusChanges: boolean) => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const [lineComment, setLineComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const codeLinesRef = useRef<HTMLDivElement | null>(null);
  const language = languageForPath(file.path, file.viewerKind);
  const lines = splitCodeLines(file.content);
  const highlightedLines = html ? extractHighlightedLines(html) : null;
  const symbols = detectCodeSymbols(file.path, file.content);
  const selected = selectedRange
    ? normalizeLineRange(selectedRange.start, selectedRange.end, lines.length)
    : null;
  const currentScope = currentScopeForLine(symbols, selected?.start ?? 1);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    import("../state/highlighter.js")
      .then(({ highlightCode }) => highlightCode(file.content, language, theme))
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.content, language, theme]);

  useEffect(() => {
    setAnchorLine(null);
    setLineComment(null);
    setSelectionComment(null);
  }, [file.path]);

  function selectLine(lineNumber: number, shiftKey: boolean) {
    const next =
      shiftKey && anchorLine
        ? normalizeLineRange(anchorLine, lineNumber, lines.length)
        : normalizeLineRange(lineNumber, lineNumber, lines.length);
    setAnchorLine(shiftKey && anchorLine ? anchorLine : lineNumber);
    onSelectionChange(next);
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(label);
      window.setTimeout(() => setCopyStatus(null), 1600);
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  function updateSelectionComment() {
    const selection = selectionCommentTargetInElement(codeLinesRef.current);
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
      rect: selection.rect,
    });
    setLineComment(null);
  }

  function startLineComment(lineNumber: number, target: Element) {
    setSelectionComment(null);
    setLineComment({
      draft: sourceLineCommentDraft(file, lineNumber),
      rect: rectLikeFromElement(target),
    });
  }

  useEffect(() => {
    if (!activeCommentId) return;
    const marker = codeLinesRef.current?.querySelector<HTMLElement>(
      `[data-comment-id="${CSS.escape(activeCommentId)}"]`,
    );
    if (!marker) return;
    marker.scrollIntoView({ block: "center", behavior: "smooth" });
    window.requestAnimationFrame(() => {
      onOpenComment?.(activeCommentId, rectLikeFromElement(marker));
    });
  }, [activeCommentId, comments, onOpenComment]);

  return (
    <section className="code-pro" aria-label={`Code viewer for ${file.path}`}>
      <div className="code-pro-header">
        <div className="code-pro-title">
          <span className="file-icon">
            {iconForPath(file.path, file.viewerKind)}
          </span>
          <span>{file.path}</span>
          <small>{language}</small>
        </div>
        <div className="code-pro-actions">
          {refreshedAt ? (
            <span className="refresh-pill">
              refreshed {new Date(refreshedAt).toLocaleTimeString()}
            </span>
          ) : null}
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
              <button type="button" onClick={() => onSelectionChange(null)}>
                Clear
              </button>
            </>
          ) : (
            <span className="muted">Read-only</span>
          )}
          {copyStatus ? (
            <span className="copy-status">{copyStatus}</span>
          ) : null}
          <button
            aria-pressed={Boolean(diffEnabled)}
            className={`diff-toggle${diffEnabled ? " active" : ""}`}
            type="button"
            onClick={onDiffToggle}
          >
            Diff from HEAD
          </button>
        </div>
      </div>
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
          focusChanges={diffFocusChanges}
          renderKind="source"
          onFocusChangesChange={onDiffFocusChange}
          file={file}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : (
        <div
          className="code-lines"
          role="list"
          ref={codeLinesRef}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSelectionComment)
          }
          onKeyUp={updateSelectionComment}
        >
          {lines.map((line, index) => {
            const lineNumber = index + 1;
            const selectedLine = lineInRange(lineNumber, selected);
            const highlighted = highlightedLines?.[index];
            const lineComments = commentsForLine(comments, lineNumber);
            const firstComment = lineComments[0];
            const activeCommentLine = lineComments.some(
              (comment) => comment.id === activeCommentId,
            );
            const draftingLine =
              lineComment?.draft.anchor.canonical.lineStart === lineNumber;
            const className = [
              "code-line",
              selectedLine ? "selected" : "",
              lineComments.length ? "has-comment" : "",
              activeCommentLine ? "active-comment" : "",
              draftingLine ? "drafting-comment" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <div
                className={className}
                data-line={lineNumber}
                key={lineNumber}
                role="listitem"
                onClick={(event) => {
                  if (firstComment) {
                    onOpenComment?.(
                      firstComment.id,
                      rectLikeFromElement(event.currentTarget),
                    );
                    return;
                  }
                  selectLine(lineNumber, event.shiftKey);
                }}
              >
                {firstComment ? (
                  <button
                    className="comment-gutter-marker code-comment-marker"
                    type="button"
                    aria-label={`Open comment on line ${lineNumber}`}
                    data-comment-id={firstComment.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenComment?.(
                        firstComment.id,
                        rectLikeFromElement(event.currentTarget),
                      );
                    }}
                  />
                ) : null}
                <button
                  className="line-number"
                  type="button"
                  aria-label={`Select line ${lineNumber}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectLine(lineNumber, event.shiftKey);
                  }}
                >
                  {lineNumber}
                </button>
                <code
                  className="line-code"
                  dangerouslySetInnerHTML={{
                    __html: highlighted ?? escapeHtml(line || " "),
                  }}
                />
                <button
                  className="code-line-comment-action"
                  type="button"
                  aria-label={
                    firstComment
                      ? `Open line note for line ${lineNumber}`
                      : `Add line note for line ${lineNumber}`
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (firstComment) {
                      onOpenComment?.(
                        firstComment.id,
                        rectLikeFromElement(event.currentTarget),
                      );
                      return;
                    }
                    startLineComment(lineNumber, event.currentTarget);
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
      />
      <SelectionCommentComposer
        draft={lineComment?.draft ?? null}
        rect={lineComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setLineComment(null)}
      />
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
