import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Inspector } from "../ui/src/features/review-queue/Inspector.js";
import { WorkbenchErrorMessage } from "../ui/src/features/workbench/WorkbenchErrorMessage.js";
import { WorkbenchPendingFileMessage } from "../ui/src/features/workbench/WorkbenchPendingFileMessage.js";
import { WorkbenchView } from "../ui/src/features/workbench/WorkbenchView.js";

it("keeps the classic sidebar, viewer, and inspector regions decomposed", () => {
  const html = renderToStaticMarkup(
    <WorkbenchView
      sidebar={<span>File tree</span>}
      viewer={<span>Active file</span>}
      inspector={<span>Review queue</span>}
    />,
  );

  expect(html).toMatch(/class="[^"]*\bsidebar\b[^"]*"/);
  expect(html).toContain('class="viewer-shell"');
  expect(html).toMatch(/class="[^"]*\binspector\b[^"]*"/);
  expect(html).toContain("File tree");
  expect(html).toContain("Active file");
  expect(html).toContain("Review queue");
});

it("keeps viewer headers sticky while file content scrolls", () => {
  const css = readFileSync(
    new URL("../ui/src/styles.css", import.meta.url),
    "utf8",
  );
  const viewerToolbarCss = readFileSync(
    new URL(
      "../ui/src/features/file-context/components/ViewerControlButton.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const viewerSurfaceCss = readFileSync(
    new URL(
      "../ui/src/features/file-context/viewers/ViewerSurface.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const diffViewerCss = readFileSync(
    new URL(
      "../ui/src/features/file-context/viewers/DiffViewer.module.css",
      import.meta.url,
    ),
    "utf8",
  );

  expect(viewerToolbarCss).toMatch(
    /\.toolbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
  );
  expect(viewerSurfaceCss).toMatch(
    /\.textViewer > :not\(:global\(\.viewer-toolbar\)\)/,
  );
  expect(css).not.toMatch(/\.text-toolbar,\s*\n\.code-pro-header/);
  expect(css).not.toMatch(/\.diff-viewer-status\s*\{[^}]*position:\s*sticky;/s);
  expect(diffViewerCss).toMatch(
    /:global\(\.diff-viewer-status\)\s*\{[^}]*position:\s*sticky;/s,
  );
  expect(viewerSurfaceCss).toMatch(
    /\.textViewer > :global\(\.diff-viewer\) :global\(\.diff-viewer-status\),[\s\S]*?\{[^}]*top:\s*54px;/,
  );
});

it("keeps inspector header focused on status instead of duplicate collapse controls", () => {
  const html = renderToStaticMarkup(
    <Inspector
      file={null}
      outline={[]}
      reviewChanges={[]}
      reviewDiffStats={{}}
      loadingReviewDiffs={{}}
      unreadReviewPaths={new Set()}
      selectedCodeRange={null}
      onOutlineSelect={() => undefined}
      onOpenEventPath={() => undefined}
      onConfirmEventPath={() => undefined}
      onOpenNextChanged={() => undefined}
      onOpenPreviousChanged={() => undefined}
      onOpenAllChanged={() => undefined}
      onRevealInTree={() => undefined}
    />,
  );

  expect(html).toContain("clear");
  expect(html).not.toContain("Collapse inspector");
  expect(html).not.toContain("Inspector target");
});

it("turns transient fetch failures into a recoverable viewer error", () => {
  const html = renderToStaticMarkup(
    <WorkbenchErrorMessage error="TypeError: Failed to fetch" />,
  );

  expect(html).toContain("Preview unavailable");
  expect(html).toContain("Vivi could not load this preview");
  expect(html).not.toContain("TypeError: Failed to fetch");
});

it("names the pending file while a preview payload loads", () => {
  const html = renderToStaticMarkup(
    <WorkbenchPendingFileMessage path="net/netfilter/xt_DSCP.c" />,
  );

  expect(html).toContain("Loading preview for");
  expect(html).toContain("net/netfilter/xt_DSCP.c");
  expect(html).toContain('aria-live="polite"');
  expect(html).not.toContain("Select a file from the tree.");
});

it("turns missing source failures into a comment-preserving viewer error", () => {
  const html = renderToStaticMarkup(
    <WorkbenchErrorMessage
      error="Error: stat /Users/tasuku/work/github.com/torvalds/linux/README.md: no such file or directory"
      path="README.md"
      sourceMissing
    />,
  );

  expect(html).toContain("Source missing");
  expect(html).toContain("README.md is not present in this workspace");
  expect(html).toContain("resolve, archive, or re-anchor");
  expect(html).not.toContain("/Users/tasuku");
  expect(html).not.toContain("stat ");
});
