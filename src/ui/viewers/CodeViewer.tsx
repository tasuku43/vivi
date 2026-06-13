import { useEffect, useState } from "react";
import type { FilePayload } from "../../domain/fs-node.js";
import { languageForPath } from "../state/file-icons.js";

export function CodeViewer({ file }: { file: FilePayload }) {
  const [html, setHtml] = useState<string | null>(null);
  const language = languageForPath(file.path, file.viewerKind);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    import("../state/highlighter.js")
      .then(({ highlightCode }) => highlightCode(file.content, language))
      .then((highlighted) => {
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.content, language]);

  if (html)
    return (
      <div
        className="code highlighted"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  return (
    <pre className="code">
      <code>{file.content}</code>
    </pre>
  );
}
