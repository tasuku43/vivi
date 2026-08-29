import type {
  CommentActor,
  CommentSource,
  ViviComment,
} from "../../domain/comments.js";

type CommentAgentKey = "human" | "unknown";

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
  unknown: {
    key: "unknown",
    label: "Unknown",
    avatarSrc: `${agentIconBasePath}/unknown.svg`,
  },
};

export function commentAgentIdentity(
  comment: Pick<ViviComment, "author" | "createdBy" | "source">,
): CommentAgentIdentity {
  const key = commentAgentKey(comment.createdBy, comment.source);
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
): CommentAgentKey {
  if (source === "human" || actor?.kind === "human") return "human";
  return "unknown";
}

function sourceLabel(source: CommentSource | undefined): string | null {
  if (source === "human") return "Human";
  return null;
}
