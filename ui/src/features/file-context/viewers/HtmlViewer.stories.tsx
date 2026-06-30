import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import docReaderMockHtml from "../../../../../docs/ui-mocks/02-doc-reader.html?raw";
import type { ViviComment } from "../../../domain/comments.js";
import { addRenderedCommentBlockIdsToHtml } from "../../../domain/rendered-comment-blocks.js";
import {
  commentsForPath,
  humanTasuku,
  htmlDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { HtmlViewer } from "./HtmlViewer.js";

const meta = {
  title: "Files/HTML Preview States",
  component: HtmlViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
  },
  args: {
    file: sampleFiles.html,
    allowHtmlScripts: false,
    theme: "light",
    comments: commentsForPath(sampleFiles.html.path),
    threadActivities: sampleThreadActivities,
    onModeChange: fn(),
    onDiffToggle: fn(),
    onCreateComment: fn(),
    onOpenComment: fn(),
    onCloseComment: fn(),
    onCommentStatusChange: fn(),
    onOpenPath: fn(),
  },
} satisfies Meta<typeof HtmlViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SourceHtmlComment: Story = {
  tags: ["interaction"],
  args: {
    mode: "source",
    comments: [],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("list")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(".source-comment-surface"),
    ).toBeInTheDocument();
    await expect(
      canvasElement.querySelector(".selection-comment-composer"),
    ).not.toBeInTheDocument();
    const lineAction = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="line-comment-action"][data-comment-surface="source"][data-line="7"][data-path="${sampleFiles.html.path}"]`,
    );
    await expect(lineAction).toBeInTheDocument();
    await userEvent.click(lineAction!);
    await expect(canvas.getByLabelText("New line comment")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Save pending draft comment" }),
    ).toBeDisabled();
    await expect(canvas.queryByText("Draft a review comment")).toBeNull();
    const previewMode = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-mode-option"][data-viewer-mode="preview"][data-viewer-path="${sampleFiles.html.path}"]`,
    );
    await expect(previewMode).toBeInTheDocument();
    await expect(previewMode).toHaveAttribute("data-active", "false");
    await userEvent.click(previewMode!);
    await expect(args.onModeChange).toHaveBeenCalledWith("preview");
    const diffToggle = canvasElement.querySelector<HTMLButtonElement>(
      `[data-testid="viewer-diff-toggle"][data-viewer-path="${sampleFiles.html.path}"]`,
    );
    await expect(diffToggle).toBeInTheDocument();
    await expect(diffToggle).toHaveAttribute("data-diff-enabled", "false");
    await userEvent.click(diffToggle!);
    await expect(args.onDiffToggle).toHaveBeenCalled();
  },
};

export const PreviewSandboxChrome: Story = {
  args: {
    mode: "preview",
  },
  parameters: {
    docs: {
      description: {
        story:
          "The iframe preview chrome and sandbox state render in Storybook; the /preview/html server response remains covered by E2E.",
      },
    },
  },
};

export const PreviewHtmlPatternGallery: Story = {
  name: "HTML preview pattern gallery",
  tags: ["interaction"],
  args: {
    mode: "preview",
    file: {
      ...sampleFiles.html,
      path: "preview/html-pattern-gallery.html",
      content: htmlPatternGalleryDocument(),
    },
    comments: [],
    previewSrcDoc: htmlPatternGalleryDocument(),
  },
  play: async ({ canvasElement }) => {
    const path = "preview/html-pattern-gallery.html";
    const frame = await waitForHtmlStoryFrame(canvasElement, path);
    await waitForHtmlPreviewReady(frame, path);
    const metrics = await waitForHtmlPatternGalleryMetrics(frame, path);

    expect(metrics.title).toBe("HTML Pattern Gallery");
    expect(metrics.controlCount).toBeGreaterThanOrEqual(4);
    expect(metrics.imageAlt).toBe("Inline preview swatch");
    expect(metrics.detailsOpen).toBe(true);
    expect(metrics.tableWrapScrollWidth).toBeGreaterThan(
      metrics.tableWrapClientWidth,
    );
    expect(metrics.tableWrapRight).toBeLessThanOrEqual(
      metrics.viewportWidth + 1,
    );
    expect(metrics.preWrapScrollWidth).toBeGreaterThan(
      metrics.preWrapClientWidth,
    );
    expect(metrics.pageScrollWidth).toBe(metrics.viewportWidth);
  },
};

export const PreviewWorkspaceLink: Story = {
  tags: ["interaction"],
  args: {
    mode: "preview",
    comments: [],
    previewSrcDoc: htmlWorkspaceLinkPreviewStoryDocument(sampleFiles.html.path),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(sampleFiles.html.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(sampleFiles.html.path) as HTMLIFrameElement;
    await waitForHtmlDraftPreviewReady(frame);
    frame.contentWindow?.postMessage(
      { type: "vivi-story-click-link", text: "product review" },
      "*",
    );
    await waitFor(() =>
      expect(args.onOpenPath).toHaveBeenCalledWith("docs/product-review.md"),
    );
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
  },
};

export const PreviewRenderedHtmlThread: Story = {
  tags: ["interaction"],
  args: {
    mode: "preview",
    activeCommentId: "comment-html-rendered",
    previewSrcDoc: htmlCommentPreviewStoryDocument(sampleFiles.html.path),
  },
  parameters: {
    docs: {
      description: {
        story:
          "A Storybook-local iframe exercises the same block-target message contract as /preview/html so rendered HTML comments open the shared thread UI.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(sampleFiles.html.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(sampleFiles.html.path) as HTMLIFrameElement;
    await waitForHtmlDraftPreviewReady(frame);

    clickHtmlStoryBlockId(frame, "html-p-1");
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();

    clickHtmlStoryBlockId(frame, "html-p-1", { altKey: true });
    await waitFor(() =>
      expect(canvas.getByLabelText("New line comment")).toBeVisible(),
    );
    await expect(
      canvas.queryByText(/HTML rendered comments should be visible/),
    ).toBeNull();
  },
};

export const PreviewKeepsThreadReplyFocused: Story = {
  name: "HTML preview keeps thread replies focused",
  tags: ["interaction"],
  args: {
    mode: "preview",
    activeCommentId: "comment-html-rendered",
    previewSrcDoc: htmlCommentPreviewStoryDocument(sampleFiles.html.path),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(sampleFiles.html.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(sampleFiles.html.path) as HTMLIFrameElement;
    await waitForHtmlDraftPreviewReady(frame);

    openHtmlStoryComment(frame);

    const thread = await canvas.findByRole("article", {
      name: "Comment thread for lines 6-7",
    });
    await expect(
      within(thread).getByText(/HTML rendered comments should be visible/),
    ).toBeVisible();

    await expect(
      within(thread).queryByRole("button", { name: "Start separate thread" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
    await expect(canvas.getByLabelText("Continue thread")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Add follow-up" }),
    ).toBeDisabled();
    await expect(
      within(thread).getByText(/HTML rendered comments should be visible/),
    ).toBeVisible();
  },
};

const multiTargetHtmlFile = {
  ...sampleFiles.html,
  content: [
    "<!doctype html>",
    "<html>",
    "  <body>",
    '    <main class="review-card">',
    "      <h1>Review Preview</h1>",
    "      <p>Rendered HTML comments map back to source blocks.</p>",
    "      <button>Approve local preview</button>",
    "      <p>Second rendered target stays line-bound.</p>",
    "    </main>",
    "  </body>",
    "</html>",
  ].join("\n"),
};

const multiTargetHtmlComments: ViviComment[] = [
  renderedHtmlStoryComment({
    id: "comment-html-preview-paragraph",
    threadId: "thread-html-preview-paragraph",
    lineStart: 6,
    blockId: "html-preview-p-1",
    selector: "[data-vivi-comment-block-id='html-preview-p-1']",
    textQuote: "Rendered HTML comments map back to source blocks.",
    body: "This existing HTML preview thread is still anchored to source line 6.",
  }),
  renderedHtmlStoryComment({
    id: "comment-html-preview-second",
    threadId: "thread-html-preview-second",
    lineStart: 8,
    blockId: "html-preview-p-2",
    selector: "[data-vivi-comment-block-id='html-preview-p-2']",
    textQuote: "Second rendered target stays line-bound.",
    body: "A second preview marker makes the current multiple-thread state visible.",
  }),
];

export const PreviewMultipleRenderedHtmlLineThreads: Story = {
  name: "HTML preview shows multiple current line threads",
  tags: ["interaction", "current-ui-observation"],
  args: {
    mode: "preview",
    file: multiTargetHtmlFile,
    comments: multiTargetHtmlComments,
    activeCommentId: "comment-html-preview-second",
    previewSrcDoc: htmlMultiTargetPreviewStoryDocument(
      multiTargetHtmlFile.path,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(multiTargetHtmlFile.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(
      multiTargetHtmlFile.path,
    ) as HTMLIFrameElement;
    await waitForHtmlPreviewReady(frame, multiTargetHtmlFile.path);

    openHtmlStoryCommentById(frame, "comment-html-preview-second");
    const thread = await canvas.findByRole("article", {
      name: "Comment thread for line 8",
    });
    await expect(thread).toBeVisible();
    await expect(
      within(thread).getByText(/multiple-thread state visible/),
    ).toBeVisible();
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();
  },
};

export const PreviewDraftComposerReplacesTarget: Story = {
  name: "HTML preview draft composer replaces the previous target",
  tags: ["interaction", "current-ui-observation"],
  args: {
    mode: "preview",
    file: multiTargetHtmlFile,
    comments: [],
    previewSrcDoc: htmlMultiTargetPreviewStoryDocument(
      multiTargetHtmlFile.path,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(multiTargetHtmlFile.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(
      multiTargetHtmlFile.path,
    ) as HTMLIFrameElement;
    await waitForHtmlPreviewReady(frame, multiTargetHtmlFile.path);

    clickHtmlStoryBlockId(frame, "html-preview-p-1", { altKey: true });
    await expect(
      await canvas.findByRole("article", {
        name: "Comment thread for line 6",
      }),
    ).toBeVisible();
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);

    clickHtmlStoryBlockId(frame, "html-preview-p-2", { altKey: true });
    await expect(
      await canvas.findByRole("article", {
        name: "Comment thread for line 8",
      }),
    ).toBeVisible();
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    await expect(
      canvas.queryByRole("article", {
        name: "Comment thread for line 6",
      }),
    ).toBeNull();
  },
};

export const SinglePreviewDraftFormFixedSlot: Story = {
  name: "HTML preview keeps one fixed draft composer",
  tags: ["interaction"],
  args: {
    mode: "preview",
    comments: [],
    previewSrcDoc: htmlDocReaderDraftPreviewStoryDocument(
      sampleFiles.html.path,
    ),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(sampleFiles.html.path),
    ).resolves.toBeInTheDocument();
    const frame = canvas.getByTitle(sampleFiles.html.path) as HTMLIFrameElement;
    await waitForHtmlDraftPreviewReady(frame);

    clickHtmlStoryBlock(
      frame,
      "This layout treats Markdown as the primary surface.",
    );
    await expect(canvas.queryByLabelText("New line comment")).toBeNull();

    clickHtmlStoryBlock(
      frame,
      "This layout treats Markdown as the primary surface.",
      {
        altKey: true,
      },
    );
    await waitFor(() =>
      expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1),
    );
    await expect(
      canvas.getByRole("article", { name: "Comment thread for lines 493-497" }),
    ).toBeVisible();
    const firstHost = await waitFor(() => {
      const host = canvasElement.querySelector<HTMLElement>(
        ".html-rendered-comment-thread-host",
      );
      expect(host).toBeInTheDocument();
      expect(host?.style.left).not.toBe("");
      expect(host?.style.top).not.toBe("");
      return host!;
    });
    const firstSlot = {
      left: firstHost.style.left,
      top: firstHost.style.top,
      width: firstHost.style.width,
    };
    const hoverStatePromise = waitForHtmlDraftHoverState(frame);
    frame.contentWindow?.postMessage(
      { type: "vivi-story-hover-layout", selector: ".viewer" },
      "*",
    );
    const hoverState = await hoverStatePromise;
    expect(hoverState.hoverCount).toBe(0);
    expect(hoverState.draftingTags).toEqual(["p"]);
    expect(hoverState.layoutDimming).toBe(false);
    expect(hoverState.bodyBackgroundColor).toBe("rgb(15, 17, 23)");

    await userEvent.type(
      canvas.getByLabelText("New line comment"),
      "Reader paragraph needs a stable rendered anchor.",
    );
    const submit = canvas.getByRole("button", {
      name: "Save pending draft comment",
    });
    await expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(args.onCreateComment).toHaveBeenCalled());

    clickHtmlStoryBlock(frame, "Rendered", { altKey: true });
    await waitFor(() => {
      expect(
        canvas.getByRole("article", {
          name: "Comment thread for lines 486-487",
        }),
      ).toBeVisible();
    });
    await expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1);
    await expect(
      canvas.queryByRole("article", {
        name: "Comment thread for lines 493-497",
      }),
    ).toBeNull();
    const secondHost = canvasElement.querySelector<HTMLElement>(
      ".html-rendered-comment-thread-host",
    );
    await expect(secondHost).toBeInTheDocument();
    expect(secondHost?.style.left).toBe(firstSlot.left);
    expect(secondHost?.style.top).toBe(firstSlot.top);
    expect(secondHost?.style.width).toBe(firstSlot.width);
  },
};

export const RenderedHtmlDiffComment: Story = {
  args: {
    mode: "preview",
    diffEnabled: true,
    diff: htmlDiff,
    activeCommentId: "comment-html-rendered",
  },
};

export const SourceDiffMode: Story = {
  args: {
    mode: "source",
    diffEnabled: true,
    diff: htmlDiff,
  },
};

function renderedHtmlStoryComment(input: {
  id: string;
  threadId: string;
  lineStart: number;
  blockId: string;
  selector: string;
  textQuote: string;
  body: string;
}): ViviComment {
  return {
    id: input.id,
    threadId: input.threadId,
    path: multiTargetHtmlFile.path,
    viewerKind: "html",
    body: input.body,
    status: "open",
    source: "human",
    createdBy: humanTasuku,
    createdAt: "2026-06-25T09:00:00.000Z",
    updatedAt: "2026-06-25T09:00:00.000Z",
    anchor: {
      surface: "rendered",
      canonical: {
        path: multiTargetHtmlFile.path,
        lineStart: input.lineStart,
        lineEnd: input.lineStart,
        quote: input.textQuote,
        fileHash: multiTargetHtmlFile.etag,
      },
      rendered: {
        kind: "html",
        blockId: input.blockId,
        selector: input.selector,
        textQuote: input.textQuote,
        sourceLineStart: input.lineStart,
        sourceLineEnd: input.lineStart,
      },
    },
  };
}

function htmlPatternGalleryDocument(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>HTML Pattern Gallery</title>
    <style>
      :root { color-scheme: light; --pattern-ink: #182126; --pattern-muted: #66727a; --pattern-surface: #ffffff; --pattern-chip: #f4f1eb; --pattern-border: #d8d0c5; --pattern-link: #255a8a; --pattern-link-soft: #e8f1fb; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f7f5ef; color: var(--pattern-ink); font: 15px/1.58 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .pattern-shell { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 40px; }
      header, main, aside, footer { min-width: 0; }
      .hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: start; border: 1px solid var(--pattern-border); border-radius: 8px; background: var(--pattern-surface); padding: 24px; }
      h1, h2, h3, p { margin-top: 0; }
      h1 { margin-bottom: 10px; font-size: clamp(28px, 4vw, 42px); line-height: 1.12; }
      h2 { margin-bottom: 12px; font-size: 20px; }
      p { overflow-wrap: anywhere; }
      nav { display: flex; flex-wrap: wrap; gap: 8px; }
      nav a, .badge { border: 1px solid var(--pattern-border); border-radius: 999px; background: var(--pattern-chip); color: var(--pattern-link); padding: 5px 9px; text-decoration: none; white-space: nowrap; }
      .content-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 320px); gap: 18px; margin-top: 18px; }
      .panel { min-width: 0; border: 1px solid var(--pattern-border); border-radius: 8px; background: var(--pattern-surface); padding: 18px; }
      .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .card { min-width: 0; border: 1px solid var(--pattern-border); border-radius: 8px; background: #fffdf8; padding: 14px; }
      blockquote { margin: 16px 0; border-left: 4px solid var(--pattern-link); background: var(--pattern-link-soft); padding: 12px 14px; }
      figure { margin: 18px 0 0; }
      img { display: block; max-width: 100%; height: auto; border: 1px solid var(--pattern-border); border-radius: 8px; }
      figcaption, small { color: var(--pattern-muted); }
      .table-wrap, .pre-wrap { max-width: 100%; overflow-x: auto; border: 1px solid var(--pattern-border); border-radius: 8px; background: var(--pattern-surface); }
      table { width: max-content; min-width: 100%; border-collapse: collapse; }
      th, td { min-width: 10rem; border-bottom: 1px solid var(--pattern-border); padding: 10px 12px; text-align: left; vertical-align: top; }
      th { background: var(--pattern-chip); }
      pre { width: max-content; min-width: 100%; margin: 0; padding: 14px; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      form { display: grid; gap: 10px; margin-top: 14px; }
      label { display: grid; gap: 4px; color: var(--pattern-muted); font-size: 12px; }
      input, select, textarea, button { width: 100%; border: 1px solid var(--pattern-border); border-radius: 7px; background: #fff; color: var(--pattern-ink); font: inherit; padding: 8px 10px; }
      button { width: auto; justify-self: start; background: var(--pattern-link); color: #fff; }
      details { border: 1px solid var(--pattern-border); border-radius: 8px; background: #fffdf8; padding: 10px 12px; }
      summary { cursor: pointer; font-weight: 700; }
      footer { margin-top: 18px; color: var(--pattern-muted); }
      @media (max-width: 720px) {
        .pattern-shell { width: min(100% - 20px, 1120px); padding-top: 10px; }
        .hero, .content-grid, .cards { grid-template-columns: minmax(0, 1fr); }
      }
    </style>
  </head>
  <body>
    <div class="pattern-shell">
      <header class="hero">
        <div>
          <h1>HTML Pattern Gallery</h1>
          <p>Preview coverage for ordinary local HTML: semantic regions, responsive cards, form controls, media, wide tables, scrollable code, disclosure, and long text such as preview.pipeline.HTMLViewer.longIdentifier.rendering.regression.case.</p>
        </div>
        <nav aria-label="Sections">
          <a href="#article">Article</a>
          <a href="#data">Data</a>
          <a href="#controls">Controls</a>
        </nav>
      </header>
      <main class="content-grid" id="article">
        <article class="panel">
          <h2>Article Rhythm</h2>
          <p>This panel mixes paragraphs with <strong>strong text</strong>, <em>emphasis</em>, inline <code>code</code>, and a local link target.</p>
          <blockquote>HTML preview should keep author styling intact while the Vivi frame stays stable around it.</blockquote>
          <div class="cards">
            <section class="card"><h3>Responsive Card</h3><p>Cards collapse to one column on narrow frames without causing page-level horizontal scroll.</p></section>
            <section class="card"><h3>Metadata</h3><p><span class="badge">sandboxed</span> <span class="badge">scripts off</span></p></section>
          </div>
          <figure>
            <img alt="Inline preview swatch" width="420" height="140" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPSc0MjAnIGhlaWdodD0nMTQwJyB2aWV3Qm94PScwIDAgNDIwIDE0MCc+PHJlY3Qgd2lkdGg9JzQyMCcgaGVpZ2h0PScxNDAnIGZpbGw9JyNmNmY4ZmEnLz48cmVjdCB4PScyNCcgeT0nMjQnIHdpZHRoPSczNzInIGhlaWdodD0nOTInIHJ4PSc4JyBmaWxsPScjZmZmZmZmJyBzdHJva2U9JyM5YWE0YjInLz48Y2lyY2xlIGN4PSc3MicgY3k9JzcwJyByPScyNCcgZmlsbD0nIzI1NjNlYicvPjxwYXRoIGQ9J00xMTggODhoMjEwTTExOCA1OGgyNTQnIHN0cm9rZT0nIzM3NDE1MScgc3Ryb2tlLXdpZHRoPScxMicgc3Ryb2tlLWxpbmVjYXA9J3JvdW5kJy8+PC9zdmc+">
            <figcaption>Data URI image with intrinsic dimensions.</figcaption>
          </figure>
        </article>
        <aside class="panel">
          <h2>Inspector-like Aside</h2>
          <details open><summary>Open disclosure</summary><p>Details content remains readable and does not cover nearby controls.</p></details>
          <form id="controls">
            <label>Search query<input value="rendered HTML preview" readonly></label>
            <label>Mode<select><option>Preview</option><option>Source</option></select></label>
            <label>Notes<textarea rows="3" readonly>Readonly form controls keep their sizing in the frame.</textarea></label>
            <button type="button">Local action</button>
          </form>
        </aside>
      </main>
      <section class="panel" id="data" aria-label="Dense data and code">
        <h2>Dense Data</h2>
        <div class="table-wrap" tabindex="0" aria-label="Scrollable HTML table">
          <table>
            <thead><tr><th>Surface</th><th>Owner</th><th>Status</th><th>Long Value</th><th>Notes</th></tr></thead>
            <tbody>
              <tr><td>HTML preview</td><td>Viewer</td><td>Ready</td><td>preview.pipeline.html.table.scroll.regression.identifier</td><td>Wide content scrolls inside this table region.</td></tr>
              <tr><td>Sandbox</td><td>Server</td><td>Guarded</td><td>allow-scripts-off-by-default-contract</td><td>The story keeps the iframe chrome visible.</td></tr>
            </tbody>
          </table>
        </div>
        <h2>Code Block</h2>
        <div class="pre-wrap" tabindex="0" aria-label="Scrollable HTML code block">
          <pre><code>&lt;section class="preview.pipeline.html.long.code.sample.that.should.scroll.inside.the.preview.with.a.very.long.attribute.value.for.viewport.regression.coverage"&gt;
  &lt;p&gt;Long code remains inspectable without widening the whole iframe document.&lt;/p&gt;
&lt;/section&gt;</code></pre>
        </div>
      </section>
      <footer>HTML preview pattern gallery footer.</footer>
    </div>
    <script>
      (() => {
        const path = "preview/html-pattern-gallery.html";
        const requiredElement = (selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error("Missing HTML pattern element: " + selector);
          return element;
        };
        const metrics = () => {
          const tableWrap = requiredElement(".table-wrap");
          const preWrap = requiredElement(".pre-wrap");
          const image = requiredElement("img");
          const details = requiredElement("details");
          return {
            controlCount: document.querySelectorAll("input, select, textarea, button").length,
            detailsOpen: details.open,
            imageAlt: image.getAttribute("alt"),
            pageScrollWidth: document.documentElement.scrollWidth,
            preWrapClientWidth: preWrap.clientWidth,
            preWrapScrollWidth: preWrap.scrollWidth,
            tableWrapClientWidth: tableWrap.clientWidth,
            tableWrapRight: tableWrap.getBoundingClientRect().right,
            tableWrapScrollWidth: tableWrap.scrollWidth,
            title: document.title,
            viewportWidth: document.documentElement.clientWidth
          };
        };
        const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
        const postMetrics = () => parent.postMessage({ type: "vivi-story-html-pattern-metrics", path, metrics: metrics() }, "*");
        window.addEventListener("message", (event) => {
          if (event.source !== parent) return;
          if (event.data?.type === "vivi-story-ready-request" && event.data.path === path) {
            postReady();
            return;
          }
          if (event.data?.type === "vivi-story-html-pattern-metrics-request" && event.data.path === path) {
            postMetrics();
          }
        });
        if (document.readyState === "complete") postReady();
        else window.addEventListener("load", postReady, { once: true });
      })();
    </script>
  </body>
</html>`;
}

function htmlWorkspaceLinkPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <body>
    <main>
      <h1>Workspace links</h1>
      <p>Open the <a href="docs/product-review.md">product review</a>.</p>
    </main>
    <script>
      (() => {
        const path = ${JSON.stringify(path)};
        const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
        const openPath = (targetPath) => parent.postMessage({ type: "vivi-html-open-path", path, targetPath }, "*");
        document.addEventListener("click", (event) => {
          const link = event.target.closest?.("a[href]");
          if (!link) return;
          event.preventDefault();
          event.stopPropagation();
          openPath("docs/product-review.md");
        });
        window.addEventListener("message", (event) => {
          if (event.source === parent && event.data?.type === "vivi-story-ready-request") {
            postReady();
            return;
          }
          if (event.source === parent && event.data?.type === "vivi-story-click-link") {
            const link = Array.from(document.querySelectorAll("a[href]")).find((item) => item.textContent.trim() === event.data.text);
            link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
          }
        });
        postReady();
      })();
    </script>
  </body>
</html>`;
}

function htmlMultiTargetPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 28px; font: 15px/1.6 Inter, system-ui, sans-serif; color: #172426; background: #fbfaf7; }
      .review-card { max-width: 760px; border: 1px solid #d4c9b8; border-radius: 8px; background: white; padding: 24px; }
      h1 { margin: 0 0 14px; font-size: 28px; }
      p { margin: 0 0 14px; }
      button { border: 1px solid #b9ac96; border-radius: 7px; background: #fffaf0; color: #332b20; padding: 8px 12px; margin: 0 0 14px; }
      .vivi-rendered-comment-block { --vivi-color-comment-surface: rgba(126,87,194,.12); --vivi-color-comment-surface-active: rgba(126,87,194,.2); --vivi-color-comment-border: rgba(126,87,194,.35); --vivi-color-comment-text: #5e3aa3; --vivi-color-surface-panel: white; --vivi-color-surface-palette: #fbfaf7; isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
      .vivi-rendered-comment-block::before { content: ""; position: absolute; z-index: 0; inset: 0; border-radius: inherit; pointer-events: none; }
      .vivi-rendered-comment-block > * { position: relative; z-index: 1; }
      .has-rendered-comment::before, .drafting-rendered-comment::before { background: linear-gradient(90deg, var(--vivi-color-comment-surface-active), var(--vivi-color-comment-surface) 68%, transparent); box-shadow: inset 2px 0 0 var(--vivi-color-comment-border); }
      .active-rendered-comment::before { background: linear-gradient(90deg, rgba(126,87,194,.26), rgba(126,87,194,.12) 72%, transparent); box-shadow: inset 3px 0 0 var(--vivi-color-comment-text), 0 0 0 1px rgba(126,87,194,.18); }
      .rendered-comment-marker { position: absolute; right: 8px; top: 50%; width: 20px; height: 20px; border: 1px solid var(--vivi-color-comment-border); border-radius: 6px; background: var(--vivi-color-surface-panel); color: var(--vivi-color-comment-text); transform: translateY(-50%); cursor: pointer; }
      .rendered-comment-marker-count { position: absolute; right: -5px; top: -6px; min-width: 13px; height: 13px; border: 1px solid var(--vivi-color-comment-border); border-radius: 999px; background: var(--vivi-color-surface-palette); color: var(--vivi-color-comment-text); font-size: 8px; font-weight: 800; line-height: 13px; }
    </style>
  </head>
  <body>
    <main class="review-card">
      <h1 data-vivi-comment-block-id="html-preview-h1" data-vivi-source-line-start="5" data-vivi-source-line-end="5">Review Preview</h1>
      <p data-vivi-comment-block-id="html-preview-p-1" data-vivi-source-line-start="6" data-vivi-source-line-end="6">Rendered HTML comments map back to source blocks.</p>
      <button data-vivi-comment-block-id="html-preview-button" data-vivi-source-line-start="7" data-vivi-source-line-end="7" type="button">Approve local preview</button>
      <p data-vivi-comment-block-id="html-preview-p-2" data-vivi-source-line-start="8" data-vivi-source-line-end="8">Second rendered target stays line-bound.</p>
    </main>
    <script>
      (() => {
        const path = ${JSON.stringify(path)};
        const blocks = Array.from(document.querySelectorAll("[data-vivi-comment-block-id]"));
        const blockById = (id) => blocks.find((item) => item.dataset.viviCommentBlockId === id);
        const readableText = (block) => (block?.innerText || block?.textContent || "").replace(/\\s+/g, " ").trim();
        const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
        const hasRenderedCommentModifier = (event) => event.altKey || event.ctrlKey || event.metaKey;
        const postTarget = (type, block, id) => {
          const rect = block.getBoundingClientRect();
          parent.postMessage({
            type,
            path,
            id,
            blockId: block.dataset.viviCommentBlockId,
            blockIds: [block.dataset.viviCommentBlockId],
            selector: "[data-vivi-comment-block-id='" + block.dataset.viviCommentBlockId + "']",
            text: readableText(block),
            sourceLineStart: Number(block.dataset.viviSourceLineStart),
            sourceLineEnd: Number(block.dataset.viviSourceLineEnd),
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          }, "*");
        };
        const applyComments = (eventData) => {
          const drafting = new Set(eventData.draftingBlockIds || []);
          const comments = Array.isArray(eventData.comments) ? eventData.comments : [];
          blocks.forEach((block) => {
            block.className = "vivi-rendered-comment-block";
            block.querySelector(".rendered-comment-marker")?.remove();
            if (drafting.has(block.dataset.viviCommentBlockId)) block.classList.add("drafting-rendered-comment");
          });
          comments.forEach((comment) => {
            if (comment.status === "archived") return;
            const block = blockById(comment.blockId);
            if (!block) return;
            block.classList.add("has-rendered-comment");
            if (eventData.activeCommentId === comment.id) block.classList.add("active-rendered-comment");
            const action = document.createElement("button");
            action.type = "button";
            action.className = "rendered-comment-marker";
            action.dataset.commentId = comment.id;
            action.setAttribute("aria-label", "Open comment thread with 1 message");
            action.innerHTML = '<span class="rendered-comment-marker-count" aria-hidden="true">1</span>';
            action.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              postTarget("vivi-html-comment-open", block, comment.id);
            });
            block.append(action);
          });
        };
        window.addEventListener("message", (event) => {
          if (event.source === parent && event.data?.type === "vivi-story-ready-request") {
            postReady();
            return;
          }
          if (event.source === parent && event.data?.type === "vivi-story-click-block") {
            const block = blockById(event.data.blockId);
            if (block && hasRenderedCommentModifier(event.data)) postTarget("vivi-html-block-target", block);
            return;
          }
          if (event.source === parent && event.data?.type === "vivi-story-open-comment") {
            const marker = document.querySelector(".rendered-comment-marker[data-comment-id='" + event.data.id + "']");
            marker?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return;
          }
          if (event.source !== parent || event.data?.type !== "vivi-html-comments" || event.data.path !== path) return;
          applyComments(event.data);
        });
        blocks.forEach((block) => block.addEventListener("click", (event) => {
          if (!hasRenderedCommentModifier(event)) return;
          event.preventDefault();
          event.stopPropagation();
          postTarget("vivi-html-block-target", block);
        }));
        postReady();
      })();
    </script>
  </body>
</html>`;
}

function htmlDocReaderDraftPreviewStoryDocument(path: string): string {
  const annotated = addRenderedCommentBlockIdsToHtml(docReaderMockHtml);
  const styles = `<style data-vivi-story-comment-preview>
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --vivi-color-border-soft: rgba(255,255,255,.06); --vivi-color-comment-surface: rgba(169,134,255,.14); --vivi-color-comment-surface-active: rgba(169,134,255,.22); --vivi-color-comment-border: rgba(169,134,255,.42); isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
    .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; top: 0; right: var(--rendered-comment-block-right); bottom: 0; left: var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
    .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
    .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--vivi-color-border-soft); }
    .vivi-rendered-comment-block.drafting-rendered-comment:not(tr)::before, tr.vivi-rendered-comment-block.drafting-rendered-comment { background: linear-gradient(90deg, var(--vivi-color-comment-surface-active), color-mix(in srgb, var(--vivi-color-comment-surface) 56%, transparent) 68%, transparent); box-shadow: inset 2px 0 0 var(--vivi-color-comment-border); }
  </style>`;
  const script = `<script>
    (() => {
      const path = ${JSON.stringify(path)};
      const blockSelector = "[data-vivi-comment-block-id]";
      const layoutContainerBlockTags = new Set(["main", "section", "article", "nav", "aside", "header", "footer", "figure"]);
      let draftingBlockIds = [];
      let openBlockIds = [];
      let hoveredBlock = null;
      const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
      const readableText = (element) => (element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
      const isLayoutContainerBlock = (element) =>
        element?.matches?.(blockSelector) &&
        layoutContainerBlockTags.has(element.localName) &&
        Boolean(element.querySelector(blockSelector));
      const isCommentableBlock = (element) =>
        element?.matches?.(blockSelector) && !isLayoutContainerBlock(element);
      const renderedThreadOpen = () => openBlockIds.length > 0 || draftingBlockIds.length > 0;
      const closestBlock = (target) => {
        if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
        let element = target;
        while (element && element.nodeType === Node.ELEMENT_NODE && element !== document.documentElement) {
          if (isCommentableBlock(element)) return element;
          element = element.parentElement;
        }
        return null;
      };
      const commentableBlocks = () => Array.from(document.querySelectorAll(blockSelector)).filter(isCommentableBlock);
      const setHoveredBlock = (block) => {
        if (hoveredBlock === block) return;
        hoveredBlock?.classList.remove("hover-rendered-comment-block");
        hoveredBlock = block;
        hoveredBlock?.classList.add("hover-rendered-comment-block");
      };
      const postBlock = (block) => {
        const rect = block.getBoundingClientRect();
        parent.postMessage({
          type: "vivi-html-block-target",
          path,
          blockId: block.dataset.viviCommentBlockId,
          blockIds: [block.dataset.viviCommentBlockId],
          selector: "[data-vivi-comment-block-id='" + block.dataset.viviCommentBlockId + "']",
          text: readableText(block),
          sourceLineStart: Number(block.dataset.viviSourceLineStart),
          sourceLineEnd: Number(block.dataset.viviSourceLineEnd),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }, "*");
      };
      const hasRenderedCommentModifier = (event) => event.altKey || event.ctrlKey || event.metaKey;
      const classState = () => ({
        type: "vivi-story-hover-state",
        path,
        hoverCount: document.querySelectorAll(".hover-rendered-comment-block").length,
        hoverTags: Array.from(document.querySelectorAll(".hover-rendered-comment-block")).map((item) => item.localName),
        draftingTags: Array.from(document.querySelectorAll(".drafting-rendered-comment")).map((item) => item.localName),
        layoutDimming: Array.from(document.querySelectorAll("main,section,article,nav,aside,header,footer,figure")).some((item) => item.classList.contains("hover-rendered-comment-block") || item.classList.contains("drafting-rendered-comment")),
        bodyBackgroundColor: getComputedStyle(document.body).backgroundColor
      });
      const resetBlockClasses = (block) => {
        block.classList.add("vivi-rendered-comment-block");
        block.classList.remove("hover-rendered-comment-block", "drafting-rendered-comment");
      };
      const applyHighlights = () => {
        const blocks = commentableBlocks();
        blocks.forEach(resetBlockClasses);
        blocks
          .filter((block) => draftingBlockIds.includes(block.dataset.viviCommentBlockId))
          .forEach((block) => block.classList.add("drafting-rendered-comment"));
        if (renderedThreadOpen()) setHoveredBlock(null);
      };
      window.addEventListener("message", (event) => {
        if (event.source === parent && event.data?.type === "vivi-story-ready-request") {
          postReady();
          return;
        }
        if (event.source === parent && event.data?.type === "vivi-story-click-text") {
          const block = commentableBlocks().find((item) => readableText(item).includes(event.data.text));
          if (block && hasRenderedCommentModifier(event.data)) postBlock(block);
          return;
        }
        if (event.source === parent && event.data?.type === "vivi-story-hover-layout") {
          const element = document.querySelector(event.data.selector);
          setHoveredBlock(renderedThreadOpen() ? null : closestBlock(element));
          parent.postMessage(classState(), "*");
          return;
        }
        if (event.source !== parent || event.data?.type !== "vivi-html-comments" || event.data.path !== path) return;
        draftingBlockIds = Array.isArray(event.data.draftingBlockIds) ? event.data.draftingBlockIds : [];
        openBlockIds = Array.isArray(event.data.openBlockIds) ? event.data.openBlockIds : [];
        applyHighlights();
      });
      document.addEventListener("click", (event) => {
        const block = closestBlock(event.target);
        if (!block) return;
        if (!hasRenderedCommentModifier(event)) return;
        event.preventDefault();
        event.stopPropagation();
        postBlock(block);
      });
      document.addEventListener("pointermove", (event) => setHoveredBlock(renderedThreadOpen() ? null : closestBlock(event.target)));
      applyHighlights();
      postReady();
    })();
  </script>`;
  return annotated
    .replace("</head>", `${styles}</head>`)
    .replace("</body>", `${script}</body>`);
}

function htmlDraftPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 24px; font: 14px/1.55 Inter, system-ui, sans-serif; color: #192225; background: #f6f4ee; }
      .reader-shell { max-width: 980px; border: 1px solid #d9d0c2; border-radius: 8px; background: white; overflow: hidden; box-shadow: 0 18px 40px rgba(42, 35, 24, .12); }
      .reader-topbar { display: flex; gap: 12px; align-items: center; padding: 12px 18px; border-bottom: 1px solid #e7ded0; background: #fbfaf7; }
      .reader-topbar strong { margin-right: auto; }
      .pill { border: 1px solid #d8cebd; border-radius: 999px; color: #6b604f; font-size: 12px; padding: 3px 8px; }
      .reader-body { display: grid; grid-template-columns: minmax(0, 1fr) 240px; min-height: 520px; }
      .article { padding: 26px 32px 36px; }
      .rail { border-left: 1px solid #e7ded0; background: #fbfaf7; padding: 18px; }
      h1 { margin: 0 0 10px; font-size: 28px; }
      h2 { margin: 30px 0 10px; font-size: 18px; }
      p { margin: 0 0 14px; }
      .lede { color: #4f5a5e; font-size: 16px; }
      .callout { border-left: 4px solid #668dd6; background: #eef4ff; padding: 12px 14px; margin: 18px 0; }
      .decision-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0 22px; }
      .decision-card { border: 1px solid #ded6ca; border-radius: 8px; padding: 14px; background: #fffdf9; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0 24px; font-size: 13px; }
      th, td { border-bottom: 1px solid #e5ded4; padding: 9px 10px; text-align: left; }
      button { border: 1px solid #b9ac96; border-radius: 7px; background: #fffaf0; color: #332b20; padding: 8px 12px; }
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --vivi-color-border-soft: rgba(24,32,47,.08); isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
      .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; top: 0; right: var(--rendered-comment-block-right); bottom: 0; left: var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
      .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
      .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--vivi-color-border-soft); }
      .drafting-rendered-comment { outline: 2px solid #7e57c2; outline-offset: 3px; }
    </style>
  </head>
  <body>
    <main class="reader-shell">
      <div class="reader-topbar"><strong>Spec review</strong><span class="pill">HTML preview</span><span class="pill">Sandboxed</span></div>
      <div class="reader-body">
        <article class="article" data-vivi-comment-block-id="html-draft-section" data-vivi-source-line-start="9" data-vivi-source-line-end="24">
          <h1 data-vivi-comment-block-id="html-draft-h1" data-vivi-source-line-start="10" data-vivi-source-line-end="10">Rendered review notes</h1>
          <p class="lede" data-vivi-comment-block-id="html-draft-p" data-vivi-source-line-start="11" data-vivi-source-line-end="11">A realistic document preview mixes headings, cards, tables, controls, and long text blocks.</p>
          <aside class="callout" data-vivi-comment-block-id="html-draft-callout" data-vivi-source-line-start="12" data-vivi-source-line-end="14">Use one focused draft surface for HTML preview comments, even when the reader layout is dense.</aside>
          <section class="decision-grid" data-vivi-comment-block-id="html-draft-grid" data-vivi-source-line-start="15" data-vivi-source-line-end="21">
            <div class="decision-card"><h2>Comment model</h2><p>HTML anchors map to rendered blocks and source ranges.</p></div>
            <div class="decision-card"><h2>Preview behavior</h2><p>The composer stays in a predictable fixed slot.</p></div>
          </section>
          <button
            data-vivi-comment-block-id="html-draft-button"
            data-vivi-source-line-start="18"
            data-vivi-source-line-end="20"
            type="button"
          >Approve local preview</button>
          <table data-vivi-comment-block-id="html-draft-table" data-vivi-source-line-start="22" data-vivi-source-line-end="23"><tr><th>Surface</th><th>Rule</th></tr><tr><td>HTML</td><td>One floating composer</td></tr></table>
        </article>
        <aside class="rail"><h2>In this file</h2><p>Outline, metadata, and recent events remain visible next to the reader.</p></aside>
      </div>
    </main>
    <script>
      (() => {
        const path = ${JSON.stringify(path)};
        const blocks = Array.from(document.querySelectorAll("[data-vivi-comment-block-id]"));
        const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
        const postBlock = (block) => {
          const rect = block.getBoundingClientRect();
          parent.postMessage({
            type: "vivi-html-block-target",
            path,
            blockId: block.dataset.viviCommentBlockId,
            blockIds: [block.dataset.viviCommentBlockId],
            selector: "[data-vivi-comment-block-id='" + block.dataset.viviCommentBlockId + "']",
            text: block.textContent.trim(),
            sourceLineStart: Number(block.dataset.viviSourceLineStart),
            sourceLineEnd: Number(block.dataset.viviSourceLineEnd),
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          }, "*");
        };
        const hasRenderedCommentModifier = (event) => event.altKey || event.ctrlKey || event.metaKey;
        window.addEventListener("message", (event) => {
          if (event.source === parent && event.data?.type === "vivi-story-click-block") {
            const block = blocks.find((item) => item.dataset.viviCommentBlockId === event.data.blockId);
            if (block) postBlock(block);
            return;
          }
          if (event.source === parent && event.data?.type === "vivi-story-hover-block") {
            blocks.forEach((item) => item.classList.remove("hover-rendered-comment-block"));
            const block = blocks.find((item) => item.dataset.viviCommentBlockId === event.data.blockId);
            if (block) {
              block.classList.add("hover-rendered-comment-block");
              block.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: block.getBoundingClientRect().left + 8, clientY: block.getBoundingClientRect().top + 8 }));
              parent.postMessage({
                type: "vivi-story-hover-state",
                path,
                blockId: block.dataset.viviCommentBlockId,
                beforeZIndex: getComputedStyle(block, "::before").zIndex,
                bodyBackgroundColor: getComputedStyle(document.body).backgroundColor
              }, "*");
            }
            return;
          }
          if (event.source === parent && event.data?.type === "vivi-story-ready-request") {
            postReady();
            return;
          }
          if (event.source !== parent || event.data?.type !== "vivi-html-comments" || event.data.path !== path) return;
          const drafting = new Set(event.data.draftingBlockIds || []);
          blocks.forEach((block) => {
            block.className = "vivi-rendered-comment-block";
            if (drafting.has(block.dataset.viviCommentBlockId)) block.classList.add("drafting-rendered-comment");
          });
        });
        blocks.forEach((block) => block.addEventListener("click", (event) => {
          if (!hasRenderedCommentModifier(event)) return;
          event.preventDefault();
          event.stopPropagation();
          postBlock(block);
        }));
        postReady();
      })();
    </script>
  </body>
</html>`;
}

function clickHtmlStoryBlock(
  frame: HTMLIFrameElement,
  text: string,
  init: MouseEventInit = {},
): void {
  frame.contentWindow?.postMessage(
    {
      type: "vivi-story-click-text",
      text,
      altKey: init.altKey === true,
      ctrlKey: init.ctrlKey === true,
      metaKey: init.metaKey === true,
    },
    "*",
  );
}

function clickHtmlStoryBlockId(
  frame: HTMLIFrameElement,
  blockId: string,
  init: MouseEventInit = {},
): void {
  frame.contentWindow?.postMessage(
    {
      type: "vivi-story-click-block",
      blockId,
      altKey: init.altKey === true,
      ctrlKey: init.ctrlKey === true,
      metaKey: init.metaKey === true,
    },
    "*",
  );
}

function openHtmlStoryComment(frame: HTMLIFrameElement): void {
  frame.contentWindow?.postMessage(
    { type: "vivi-story-open-comment", id: "comment-html-rendered" },
    "*",
  );
}

function openHtmlStoryCommentById(frame: HTMLIFrameElement, id: string): void {
  frame.contentWindow?.postMessage(
    { type: "vivi-story-open-comment", id },
    "*",
  );
}

async function waitForHtmlPreviewReady(
  frame: HTMLIFrameElement,
  path: string,
): Promise<void> {
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("missing HTML preview frame");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("HTML preview story frame did not become ready"));
    }, 3000);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameWindow ||
        event.data?.type !== "vivi-story-html-ready" ||
        event.data.path !== path
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve();
    };
    window.addEventListener("message", onMessage);
    frameWindow.postMessage({ type: "vivi-story-ready-request", path }, "*");
  });
}

async function waitForHtmlDraftPreviewReady(
  frame: HTMLIFrameElement,
): Promise<void> {
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("missing HTML preview frame");
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("HTML preview story frame did not become ready"));
    }, 3000);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameWindow ||
        event.data?.type !== "vivi-story-html-ready" ||
        event.data.path !== sampleFiles.html.path
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve();
    };
    window.addEventListener("message", onMessage);
    frameWindow.postMessage({ type: "vivi-story-ready-request" }, "*");
  });
}

async function waitForHtmlStoryFrame(
  canvasElement: HTMLElement,
  path: string,
): Promise<HTMLIFrameElement> {
  await waitFor(
    () => {
      expect(canvasElement.querySelector(".html-viewer")).toBeInTheDocument();
      const frame = Array.from(canvasElement.querySelectorAll("iframe")).find(
        (item) => item.title === path,
      );
      expect(frame).toBeInTheDocument();
      expect(frame?.contentWindow).not.toBeNull();
    },
    { timeout: 5000 },
  );
  const frame = Array.from(canvasElement.querySelectorAll("iframe")).find(
    (item) => item.title === path,
  );
  if (!frame) throw new Error(`missing HTML preview frame: ${path}`);
  return frame;
}

async function waitForHtmlPatternGalleryMetrics(
  frame: HTMLIFrameElement,
  path: string,
): Promise<{
  controlCount: number;
  detailsOpen: boolean;
  imageAlt: string | null;
  pageScrollWidth: number;
  preWrapClientWidth: number;
  preWrapScrollWidth: number;
  tableWrapClientWidth: number;
  tableWrapRight: number;
  tableWrapScrollWidth: number;
  title: string;
  viewportWidth: number;
}> {
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("missing HTML preview frame");
  return await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("HTML pattern gallery metrics were not reported"));
    }, 3000);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameWindow ||
        event.data?.type !== "vivi-story-html-pattern-metrics" ||
        event.data.path !== path
      ) {
        return;
      }
      const metrics = event.data.metrics ?? {};
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({
        controlCount: Number(metrics.controlCount),
        detailsOpen: metrics.detailsOpen === true,
        imageAlt:
          typeof metrics.imageAlt === "string" ? metrics.imageAlt : null,
        pageScrollWidth: Number(metrics.pageScrollWidth),
        preWrapClientWidth: Number(metrics.preWrapClientWidth),
        preWrapScrollWidth: Number(metrics.preWrapScrollWidth),
        tableWrapClientWidth: Number(metrics.tableWrapClientWidth),
        tableWrapRight: Number(metrics.tableWrapRight),
        tableWrapScrollWidth: Number(metrics.tableWrapScrollWidth),
        title: String(metrics.title),
        viewportWidth: Number(metrics.viewportWidth),
      });
    };
    window.addEventListener("message", onMessage);
    frameWindow.postMessage(
      { type: "vivi-story-html-pattern-metrics-request", path },
      "*",
    );
  });
}

async function waitForHtmlDraftHoverState(frame: HTMLIFrameElement): Promise<{
  hoverCount: number;
  hoverTags: string[];
  draftingTags: string[];
  layoutDimming: boolean;
  bodyBackgroundColor: string;
}> {
  const frameWindow = frame.contentWindow;
  if (!frameWindow) throw new Error("missing HTML preview frame");
  return await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("HTML preview story frame did not report hover state"));
    }, 3000);
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frameWindow ||
        event.data?.type !== "vivi-story-hover-state" ||
        event.data.path !== sampleFiles.html.path
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({
        hoverCount: Number(event.data.hoverCount),
        hoverTags: Array.isArray(event.data.hoverTags)
          ? event.data.hoverTags.map(String)
          : [],
        draftingTags: Array.isArray(event.data.draftingTags)
          ? event.data.draftingTags.map(String)
          : [],
        layoutDimming: event.data.layoutDimming === true,
        bodyBackgroundColor: String(event.data.bodyBackgroundColor),
      });
    };
    window.addEventListener("message", onMessage);
  });
}

function htmlCommentPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 28px; font: 15px/1.6 Inter, system-ui, sans-serif; color: #172426; background: #fbfaf7; }
      .review-card { max-width: 760px; border: 1px solid #d4c9b8; border-radius: 8px; background: white; padding: 24px; }
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --vivi-color-border-soft: rgba(24,32,47,.08); --vivi-color-surface-panel: white; --vivi-color-surface-palette: #fbfaf7; --vivi-color-comment-surface: rgba(126,87,194,.12); --vivi-color-comment-surface-active: rgba(126,87,194,.2); --vivi-color-comment-border: rgba(126,87,194,.35); --vivi-color-comment-text: #5e3aa3; isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
      .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; inset: 0 var(--rendered-comment-block-right) 0 var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
      .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
	      .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--vivi-color-border-soft); }
	      .has-rendered-comment:not(tr), .active-rendered-comment:not(tr), .drafting-rendered-comment:not(tr) { background: transparent; box-shadow: none; }
	      blockquote.vivi-rendered-comment-block.has-rendered-comment, blockquote.vivi-rendered-comment-block.drafting-rendered-comment, blockquote.vivi-rendered-comment-block.active-rendered-comment { border-left-color: transparent !important; }
	      .has-rendered-comment:not(tr)::before, .drafting-rendered-comment:not(tr)::before, tr.has-rendered-comment, tr.drafting-rendered-comment { background: linear-gradient(90deg, var(--vivi-color-comment-surface-active), color-mix(in srgb, var(--vivi-color-comment-surface) 56%, transparent) 68%, transparent); box-shadow: inset 2px 0 0 var(--vivi-color-comment-border); }
      .active-rendered-comment:not(tr)::before, tr.active-rendered-comment { background: linear-gradient(90deg, color-mix(in srgb, var(--vivi-color-comment-surface-active) 86%, white), var(--vivi-color-comment-surface) 72%, transparent); box-shadow: inset 3px 0 0 var(--vivi-color-comment-text), 0 0 0 1px color-mix(in srgb, var(--vivi-color-comment-border) 46%, transparent); }
      .rendered-comment-range-start.has-rendered-comment, .rendered-comment-range-start.drafting-rendered-comment { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
      .rendered-comment-range-middle.has-rendered-comment, .rendered-comment-range-middle.drafting-rendered-comment { border-radius: 0; }
      .rendered-comment-range-end.has-rendered-comment, .rendered-comment-range-end.drafting-rendered-comment { border-top-left-radius: 0; border-top-right-radius: 0; }
      .rendered-comment-range-join-after:not(tr)::after { content: ""; position: absolute; z-index: 1; left: var(--rendered-comment-block-left); right: var(--rendered-comment-block-right); top: 100%; height: var(--rendered-comment-join-after, 0); pointer-events: none; background: linear-gradient(90deg, var(--vivi-color-comment-surface-active), color-mix(in srgb, var(--vivi-color-comment-surface) 56%, transparent) 68%, transparent); }
      .active-rendered-comment.rendered-comment-range-join-after:not(tr)::after { background: linear-gradient(90deg, color-mix(in srgb, var(--vivi-color-comment-surface-active) 86%, white), var(--vivi-color-comment-surface) 72%, transparent); }
      .rendered-comment-marker { position: absolute; right: 8px; top: 50%; width: 20px; height: 20px; border: 1px solid var(--vivi-color-comment-border); border-radius: 6px; background: var(--vivi-color-surface-panel); color: var(--vivi-color-comment-text); transform: translateY(-50%); cursor: pointer; }
      .rendered-comment-marker-count { position: absolute; right: -5px; top: -6px; min-width: 13px; height: 13px; border: 1px solid var(--vivi-color-comment-border); border-radius: 999px; background: var(--vivi-color-surface-palette); color: var(--vivi-color-comment-text); font-size: 8px; font-weight: 800; line-height: 13px; }
    </style>
  </head>
  <body>
    <main class="review-card">
      <h1 data-vivi-comment-block-id="html-h1-1" data-vivi-source-line-start="6" data-vivi-source-line-end="6">Review Preview</h1>
      <p data-vivi-comment-block-id="html-p-1" data-vivi-source-line-start="7" data-vivi-source-line-end="7">Rendered HTML comments map back to source blocks.</p>
      <button>Approve local preview</button>
    </main>
    <script>
	      (() => {
	        const path = ${JSON.stringify(path)};
	        const blocks = Array.from(document.querySelectorAll("[data-vivi-comment-block-id='html-h1-1'], [data-vivi-comment-block-id='html-p-1']"));
	        const block = document.querySelector("[data-vivi-comment-block-id='html-p-1']");
	        const postReady = () => parent.postMessage({ type: "vivi-story-html-ready", path }, "*");
	        const postTarget = (type, id) => {
	          const firstRect = blocks[0].getBoundingClientRect();
	          const lastRect = blocks[blocks.length - 1].getBoundingClientRect();
	          parent.postMessage({
	            type,
	            path,
	            id,
	            blockId: "html-h1-1",
	            blockIds: ["html-h1-1", "html-p-1"],
	            selector: ".review-card p",
	            text: blocks.map((item) => item.textContent.trim()).join("\\n\\n"),
	            sourceLineStart: 6,
	            sourceLineEnd: 7,
	            rect: { left: firstRect.left, top: firstRect.top, width: Math.max(firstRect.width, lastRect.width), height: lastRect.bottom - firstRect.top }
	          }, "*");
	        };
	        const pixelValue = (value) => {
	          const parsed = Number.parseFloat(value);
	          return Number.isFinite(parsed) ? parsed : 0;
	        };
	        const applyRange = () => {
	          blocks.forEach((item) => {
	            item.className = "vivi-rendered-comment-block has-rendered-comment";
	            item.style.removeProperty("--rendered-comment-block-left");
	            item.style.removeProperty("--rendered-comment-block-right");
	            item.style.removeProperty("--rendered-comment-join-after");
	          });
	          const bounds = blocks.map((item) => {
	            const rect = item.getBoundingClientRect();
	            const before = getComputedStyle(item, "::before");
	            return { left: rect.left + pixelValue(before.left), right: rect.right - pixelValue(before.right) };
	          });
	          const rangeLeft = Math.min(...bounds.map((bound) => bound.left));
	          const rangeRight = Math.max(...bounds.map((bound) => bound.right));
	          blocks.forEach((item, index) => {
	            const rect = item.getBoundingClientRect();
	            item.style.setProperty("--rendered-comment-block-left", Math.round(rangeLeft - rect.left) + "px");
	            item.style.setProperty("--rendered-comment-block-right", Math.round(rect.right - rangeRight) + "px");
	            item.classList.add(index === 0 ? "rendered-comment-range-start" : index === blocks.length - 1 ? "rendered-comment-range-end" : "rendered-comment-range-middle");
	            if (index === blocks.length - 1) return;
	            const gap = Math.max(0, Math.round(blocks[index + 1].getBoundingClientRect().top - item.getBoundingClientRect().bottom));
	            if (gap > 1) {
	              item.classList.add("rendered-comment-range-join-after");
	              item.style.setProperty("--rendered-comment-join-after", gap + "px");
	            }
	          });
	        };
	        window.addEventListener("message", (event) => {
	          if (event.source === parent && event.data?.type === "vivi-story-ready-request") {
	            postReady();
	            return;
	          }
	          if (event.source === parent && event.data?.type === "vivi-story-click-block") {
	            const targetBlock = blocks.find((item) => item.dataset.viviCommentBlockId === event.data.blockId);
	            if (targetBlock && hasRenderedCommentModifier(event.data)) postTarget("vivi-html-block-target");
	            return;
	          }
	          if (event.source === parent && event.data?.type === "vivi-story-open-comment") {
	            postTarget("vivi-html-comment-open", event.data.id);
	            return;
	          }
	          if (event.source !== parent || event.data?.type !== "vivi-html-comments" || event.data.path !== path) return;
	          applyRange();
	          if (event.data.activeCommentId === "comment-html-rendered") blocks.forEach((item) => item.classList.add("active-rendered-comment"));
	          if (event.data.draftingBlockIds?.some((id) => id === "html-h1-1" || id === "html-p-1")) blocks.forEach((item) => item.classList.add("drafting-rendered-comment"));
	          if (!block.querySelector(".rendered-comment-marker")) {
	            const action = document.createElement("button");
            action.type = "button";
            action.className = "rendered-comment-marker";
            action.dataset.commentId = "comment-html-rendered";
            action.dataset.commentCount = "1";
            action.setAttribute("aria-label", "Open comment thread with 1 message");
            action.innerHTML = '<span class="rendered-comment-marker-count" aria-hidden="true">1</span>';
            action.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              postTarget("vivi-html-comment-open", "comment-html-rendered");
            });
            block.append(action);
          }
        });
        const hasRenderedCommentModifier = (event) => event.altKey || event.ctrlKey || event.metaKey;
        block.addEventListener("click", (event) => {
          if (!hasRenderedCommentModifier(event)) return;
          event.preventDefault();
          event.stopPropagation();
          postTarget("vivi-html-block-target");
        });
        postReady();
      })();
    </script>
  </body>
</html>`;
}
