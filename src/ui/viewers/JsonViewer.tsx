import { useMemo, useRef, useState } from "react";
import type { TextDiff } from "../../domain/change-review.js";
import type { FilePayload } from "../../domain/fs-node.js";
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

export function JsonViewer({
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
  const [mode, setMode] = useState<"tree" | "source">("tree");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    left: number;
    top: number;
  } | null>(null);
  const sourceRef = useRef<HTMLPreElement | null>(null);
  const parsed = useMemo(() => parseJson(file.content), [file.content]);
  const source = parsed.ok
    ? `${JSON.stringify(parsed.value, null, 2)}\n`
    : file.content;
  const updateSourceSelectionComment = () => {
    const selection = selectionCommentTargetInElement(sourceRef.current);
    if (!selection) {
      setSelectionComment(null);
      return;
    }
    setSelectionComment({
      draft: sourceCommentDraft(
        file,
        lineRangeForQuote(source, selection.text),
        selection.text,
      ),
      left: selection.rect.left + selection.rect.width / 2,
      top: selection.rect.top,
    });
  };

  return (
    <section className="json-viewer">
      <div className="viewer-toolbar">
        <strong>{file.path}</strong>
        <span className="sandbox-status">
          {parsed.ok ? "JSON tree" : "Invalid JSON, source shown"}
        </span>
        <button
          aria-pressed={Boolean(diffEnabled)}
          className={`diff-toggle${diffEnabled ? " active" : ""}`}
          type="button"
          onClick={onDiffToggle}
        >
          Diff from HEAD
        </button>
        <div className="segmented-control" aria-label="JSON view mode">
          <button
            className={mode === "tree" ? "active" : ""}
            type="button"
            onClick={() => setMode("tree")}
          >
            Tree
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
      ) : mode === "tree" && parsed.ok ? (
        <div className="json-tree">
          <JsonNode name={file.path} value={parsed.value} depth={0} />
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
          {source}
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

function JsonNode({
  name,
  value,
  depth,
}: {
  name: string;
  value: unknown;
  depth: number;
}) {
  if (depth > 8) {
    return (
      <div className="json-node">
        <span className="json-key">{name}</span>
        <span className="json-value muted">Depth limit</span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <details className="json-node" open={depth < 2}>
        <summary>
          <span className="json-key">{name}</span>
          <span className="json-value">Array({value.length})</span>
        </summary>
        <div className="json-children">
          {value.map((item, index) => (
            <JsonNode
              key={index}
              name={`${index}`}
              value={item}
              depth={depth + 1}
            />
          ))}
        </div>
      </details>
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <details className="json-node" open={depth < 2}>
        <summary>
          <span className="json-key">{name}</span>
          <span className="json-value">Object({entries.length})</span>
        </summary>
        <div className="json-children">
          {entries.map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="json-node leaf">
      <span className="json-key">{name}</span>
      <span className={`json-value ${jsonValueClass(value)}`}>
        {formatJsonScalar(value)}
      </span>
    </div>
  );
}

function parseJson(
  content: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    return { ok: false };
  }
}

function formatJsonScalar(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function jsonValueClass(value: unknown): string {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  return "";
}
