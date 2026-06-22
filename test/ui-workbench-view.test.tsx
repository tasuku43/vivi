import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Inspector } from "../ui/src/features/review-queue/Inspector.js";
import { WorkbenchView } from "../ui/src/features/workbench/WorkbenchView.js";

it("keeps the classic sidebar, viewer, and inspector regions decomposed", () => {
  const html = renderToStaticMarkup(
    <WorkbenchView
      sidebar={<span>File tree</span>}
      viewer={<span>Active file</span>}
      inspector={<span>Review queue</span>}
    />,
  );

  expect(html).toContain('class="sidebar"');
  expect(html).toContain('class="viewer-shell"');
  expect(html).toContain('class="inspector"');
  expect(html).toContain("File tree");
  expect(html).toContain("Active file");
  expect(html).toContain("Review queue");
});

it("keeps viewer headers sticky while file content scrolls", () => {
  const css = readFileSync(
    new URL("../ui/src/styles.css", import.meta.url),
    "utf8",
  );

  expect(css).toMatch(
    /\.viewer-toolbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
  );
  expect(css).toMatch(
    /\.text-toolbar,\s*\n\.code-pro-header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
  );
  expect(css).toMatch(
    /\.diff-viewer-status\s*\{[^}]*position:\s*sticky;/s,
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

  expect(html).toContain("Read-only");
  expect(html).not.toContain("Collapse inspector");
  expect(html).not.toContain("Inspector target");
});
