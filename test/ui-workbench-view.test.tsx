import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
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
