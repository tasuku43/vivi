import { useMemo, useRef, useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import {
  lineRangeForQuote,
  scheduleSelectionCommentUpdate,
  selectionCommentTargetInElement,
  sourceCommentDraft,
  type CommentCreateHandler,
  type CommentDraft,
} from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { CommentedSourceLines } from "../../comments/components/CommentedSourceLines.js";
import { SelectionCommentComposer } from "../../comments/components/SelectionCommentComposer.js";
import {
  DiffToggleButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import { DiffViewer } from "./DiffViewer.js";

export function JsonViewer({
  file,
  theme = "dark",
  diff,
  diffLoading,
  diffEnabled,
  onDiffToggle,
  onCreateComment,
  comments = [],
  activeCommentId,
  onOpenComment,
}: {
  file: FilePayload;
  theme?: ResolvedTheme;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  onDiffToggle?: () => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
}) {
  const [mode, setMode] = useState<"tree" | "source">("tree");
  const [selectionComment, setSelectionComment] = useState<{
    draft: CommentDraft;
    rect: DOMRectLike;
  } | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
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
      rect: selection.rect,
    });
  };

  return (
    <section className="json-viewer">
      <ViewerToolbar
        status={parsed.ok ? "JSON tree" : "Invalid JSON, source shown"}
      >
        <div className="segmented-control" aria-label="JSON view mode">
          <ViewerModeButton
            active={mode === "tree"}
            mode="tree"
            path={file.path}
            onClick={() => setMode("tree")}
          >
            Tree
          </ViewerModeButton>
          <ViewerModeButton
            active={mode === "source"}
            mode="source"
            path={file.path}
            onClick={() => setMode("source")}
          >
            Source
          </ViewerModeButton>
        </div>
        <DiffToggleButton
          enabled={diffEnabled}
          path={file.path}
          onToggle={onDiffToggle}
        />
      </ViewerToolbar>
      {diffEnabled ? (
        <DiffViewer
          path={file.path}
          diff={diff ?? null}
          loading={diffLoading}
          renderKind="source"
          theme={theme}
          file={file}
          onCreateComment={onCreateComment}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
        />
      ) : mode === "tree" && parsed.ok ? (
        <div className="json-tree">
          <JsonNode name={file.path} value={parsed.value} depth={0} />
        </div>
      ) : (
        <CommentedSourceLines
          content={source}
          className="markdown-source"
          containerRef={sourceRef}
          comments={comments}
          activeCommentId={activeCommentId}
          onOpenComment={onOpenComment}
          onMouseUp={() =>
            scheduleSelectionCommentUpdate(updateSourceSelectionComment)
          }
          onKeyUp={updateSourceSelectionComment}
        />
      )}
      <SelectionCommentComposer
        draft={selectionComment?.draft ?? null}
        rect={selectionComment?.rect ?? null}
        onSave={onCreateComment}
        onDismiss={() => setSelectionComment(null)}
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
