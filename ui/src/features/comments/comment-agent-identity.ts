import type {
  CommentActor,
  CommentSource,
  ViviComment,
} from "../../domain/comments.js";

type CommentAgentKey =
  | "human"
  | "codex"
  | "claude-code"
  | "cursor"
  | "github-copilot"
  | "windsurf"
  | "devin"
  | "unknown";

export interface CommentAgentIdentity {
  key: CommentAgentKey;
  label: string;
  avatarSrc: string;
}

const agentIconBasePath = "/vivi/agent-icons";

const agentIdentities: Record<CommentAgentKey, CommentAgentIdentity> = {
  human: {
    key: "human",
    label: "Human",
    avatarSrc: `${agentIconBasePath}/human.svg`,
  },
  codex: {
    key: "codex",
    label: "Codex",
    avatarSrc: `${agentIconBasePath}/codex.svg`,
  },
  "claude-code": {
    key: "claude-code",
    label: "Claude Code",
    avatarSrc: `${agentIconBasePath}/claude-code.svg`,
  },
  cursor: {
    key: "cursor",
    label: "Cursor",
    avatarSrc: `${agentIconBasePath}/cursor.svg`,
  },
  "github-copilot": {
    key: "github-copilot",
    label: "GitHub Copilot",
    avatarSrc: `${agentIconBasePath}/github-copilot.svg`,
  },
  windsurf: {
    key: "windsurf",
    label: "Windsurf",
    avatarSrc: `${agentIconBasePath}/windsurf.svg`,
  },
  devin: {
    key: "devin",
    label: "Devin",
    avatarSrc: `${agentIconBasePath}/devin.svg`,
  },
  unknown: {
    key: "unknown",
    label: "Unknown",
    avatarSrc: `${agentIconBasePath}/unknown.svg`,
  },
};

export function commentAgentIdentity(
  comment: Pick<ViviComment, "author" | "createdBy" | "source">,
): CommentAgentIdentity {
  const key = commentAgentKey(comment.createdBy, comment.source, comment.author);
  const identity = agentIdentities[key];
  const displayName = comment.createdBy?.displayName?.trim();
  const author = comment.author?.trim();
  return {
    ...identity,
    label:
      displayName || author || sourceLabel(comment.source) || identity.label,
  };
}

function commentAgentKey(
  actor: CommentActor | undefined,
  source: CommentSource | undefined,
  author: string | undefined,
): CommentAgentKey {
  const haystack = [
    actor?.kind,
    actor?.id,
    actor?.displayName,
    source,
    author,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("github") || haystack.includes("copilot")) {
    return "github-copilot";
  }
  if (haystack.includes("claude") || haystack.includes("anthropic")) {
    return "claude-code";
  }
  if (haystack.includes("cursor") || haystack.includes("cursol")) {
    return "cursor";
  }
  if (haystack.includes("windsurf")) return "windsurf";
  if (haystack.includes("devin") || haystack.includes("cognition")) {
    return "devin";
  }
  if (haystack.includes("codex") || haystack.includes("openai")) {
    return "codex";
  }
  if (source === "human" || actor?.kind === "human") return "human";
  return "unknown";
}

function sourceLabel(source: CommentSource | undefined): string | null {
  if (source === "codex") return "Codex";
  if (source === "claude-code") return "Claude Code";
  if (source === "human") return "Human";
  return null;
}
