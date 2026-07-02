import { useMemo, useState } from "react";
import type { TextDiff } from "../../../domain/change-review.js";
import type { ViviComment } from "../../../domain/comments.js";
import type { FilePayload } from "../../../domain/fs-node.js";
import type { CommentActivitySummary } from "../../../state/comment-activity.js";
import type { LineRange } from "../../../state/code-viewer.js";
import type {
  CommentCreateHandler,
  CommentStatusChangeHandler,
} from "../../../state/comments.js";
import type { ResolvedTheme } from "../../../state/theme.js";
import { SourceCommentSurface } from "../../comments/components/SourceCommentSurface.js";
import {
  DiffToggleButton,
  ViewerToolbar,
  ViewerModeButton,
} from "../components/ViewerControlButton.js";
import sharedUiStyles from "../../../shared/styles/SharedUi.module.css";
import { DiffViewer } from "./DiffViewer.js";
import surfaceStyles from "./ViewerSurface.module.css";

export function JsonViewer({
  file,
  initialMode,
  theme = "dark",
  diff,
  diffLoading,
  diffEnabled,
  onDiffToggle,
  onCreateComment,
  comments = [],
  activeCommentId,
  expandActiveCommentThread = true,
  currentActorId,
  onOpenComment,
  onCloseComment,
  onCommentStatusChange,
  threadActivities = {},
}: {
  file: FilePayload;
  initialMode?: "tree" | "source";
  theme?: ResolvedTheme;
  diff?: TextDiff | null;
  diffLoading?: boolean;
  diffEnabled?: boolean;
  onDiffToggle?: () => void;
  onCreateComment?: CommentCreateHandler;
  comments?: ViviComment[];
  activeCommentId?: string | null;
  expandActiveCommentThread?: boolean;
  currentActorId?: string;
  onOpenComment?: (id: string, rect: DOMRectLike) => void;
  onCloseComment?: () => void;
  onCommentStatusChange?: CommentStatusChangeHandler;
  threadActivities?: Record<string, CommentActivitySummary>;
}) {
  const [mode, setMode] = useState<"tree" | "source">(initialMode ?? "tree");
  const [selectedRange, setSelectedRange] = useState<LineRange | null>(null);
  const parsed = useMemo(() => parseJson(file.content), [file.content]);
  const source = parsed.ok
    ? `${JSON.stringify(parsed.value, null, 2)}\n`
    : file.content;
  const sourceFile: FilePayload = { ...file, content: source };

  return (
    <section className={`${surfaceStyles.jsonViewer} json-viewer`}>
      <ViewerToolbar
        status={parsed.ok ? "JSON tree" : "Invalid JSON, source shown"}
      >
        <div
          className={`${surfaceStyles.segmentedControl} segmented-control`}
          aria-label="JSON view mode"
        >
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
          expandActiveCommentThread={expandActiveCommentThread}
          currentActorId={currentActorId}
          onOpenComment={onOpenComment}
          onCommentStatusChange={onCommentStatusChange}
          threadActivities={threadActivities}
        />
      ) : mode === "tree" && parsed.ok ? (
        <div className={`${surfaceStyles.jsonTree} json-tree`}>
          <JsonNode name={file.path} value={parsed.value} depth={0} />
        </div>
      ) : (
        <SourceCommentSurface
          file={sourceFile}
          className={`markdown-source ${surfaceStyles.markdownSource}`}
          selectedRange={selectedRange}
          comments={comments}
          activeCommentId={activeCommentId}
          expandActiveCommentThread={expandActiveCommentThread}
          currentActorId={currentActorId}
          onSelectionChange={setSelectedRange}
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
      <div className={`${surfaceStyles.jsonNode} json-node`}>
        <span className={`${surfaceStyles.jsonKey} json-key`}>{name}</span>
        <span
          className={`${surfaceStyles.jsonValue} ${sharedUiStyles.muted} json-value muted`}
        >
          Depth limit
        </span>
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <details
        className={`${surfaceStyles.jsonNode} json-node`}
        open={depth < 2}
      >
        <summary>
          <span className={`${surfaceStyles.jsonKey} json-key`}>{name}</span>
          <span className={`${surfaceStyles.jsonValue} json-value`}>
            Array({value.length})
          </span>
        </summary>
        <div className={`${surfaceStyles.jsonChildren} json-children`}>
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
      <details
        className={`${surfaceStyles.jsonNode} json-node`}
        open={depth < 2}
      >
        <summary>
          <span className={`${surfaceStyles.jsonKey} json-key`}>{name}</span>
          <span className={`${surfaceStyles.jsonValue} json-value`}>
            Object({entries.length})
          </span>
        </summary>
        <div className={`${surfaceStyles.jsonChildren} json-children`}>
          {entries.map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className={`${surfaceStyles.jsonNode} json-node leaf`}>
      <span className={`${surfaceStyles.jsonKey} json-key`}>{name}</span>
      <span
        className={`${surfaceStyles.jsonValue} json-value ${jsonValueClassName(value)}`}
      >
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

function jsonValueClassName(value: unknown): string {
  if (typeof value === "string")
    return `${surfaceStyles.jsonValueString} string`;
  if (typeof value === "number")
    return `${surfaceStyles.jsonValueNumber} number`;
  if (typeof value === "boolean")
    return `${surfaceStyles.jsonValueBoolean} boolean`;
  if (value === null) return `${surfaceStyles.jsonValueNull} null`;
  return "";
}
