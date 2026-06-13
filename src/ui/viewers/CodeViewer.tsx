import { useEffect, useState } from "react";
import type { FilePayload } from "../../domain/fs-node.js";
import { languageForPath } from "../state/file-icons.js";
import type { ResolvedTheme } from "../state/theme.js";

export function CodeViewer({
  file,
  theme,
}: {
  file: FilePayload;
  theme: ResolvedTheme;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const language = languageForPath(file.path, file.viewerKind);

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
