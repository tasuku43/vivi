import { ViviClientError } from "../../application/ports/ViviClient.js";

export function viviClientHttpError(
  path: string,
  status: number,
): ViviClientError {
  const code =
    status === 404 ? "not_found" : status === 403 ? "forbidden" : "transport";
  return new ViviClientError(code, `${path} request failed: ${status}`, {
    status,
  });
}

export function viviClientGraphqlError(messages: readonly string[]): Error {
  const message = messages.join("; ");
  if (
    /\b(?:no such file or directory|file not found|path not found)\b/i.test(
      message,
    )
  ) {
    return new ViviClientError("not_found", message);
  }
  if (/\b(?:permission denied|forbidden)\b/i.test(message)) {
    return new ViviClientError("forbidden", message);
  }
  return new ViviClientError("transport", message);
}

// Old development servers do not implement workspace-shared attention.
// Only schema capability errors permit local recency fallback; transport and
// permission failures must remain visible.
export function isUnsupportedAttentionOperation(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unsupported GraphQL operation|Cannot query field "(?:attention|observeDocument)"/.test(
      error.message,
    )
  );
}
