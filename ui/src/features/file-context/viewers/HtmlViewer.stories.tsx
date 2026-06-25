import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import docReaderMockHtml from "../../../../../docs/ui-mocks/02-doc-reader.html?raw";
import { addRenderedCommentBlockIdsToHtml } from "../../../domain/rendered-comment-blocks.js";
import {
  commentsForPath,
  htmlDiff,
  sampleFiles,
  sampleThreadActivities,
} from "../../../storybook/fixtures/review-lab.js";
import { HtmlViewer } from "./HtmlViewer.js";

const meta = {
  title: "Viewers/HTML/HtmlViewer",
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
      canvas.getByRole("button", { name: "Save private draft comment" }),
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

export const SinglePreviewDraftFormFixedSlot: Story = {
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
      name: "Save private draft comment",
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

function htmlDocReaderDraftPreviewStoryDocument(path: string): string {
  const annotated = addRenderedCommentBlockIdsToHtml(docReaderMockHtml);
  const styles = `<style data-vivi-story-comment-preview>
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --soft-line: rgba(255,255,255,.06); --comment-tint: rgba(169,134,255,.14); --comment-tint-active: rgba(169,134,255,.22); --comment-line: rgba(169,134,255,.42); isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
    .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; top: 0; right: var(--rendered-comment-block-right); bottom: 0; left: var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
    .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
    .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--soft-line); }
    .vivi-rendered-comment-block.drafting-rendered-comment:not(tr)::before, tr.vivi-rendered-comment-block.drafting-rendered-comment { background: linear-gradient(90deg, var(--comment-tint-active), color-mix(in srgb, var(--comment-tint) 56%, transparent) 68%, transparent); box-shadow: inset 2px 0 0 var(--comment-line); }
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
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --soft-line: rgba(24,32,47,.08); isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
      .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; top: 0; right: var(--rendered-comment-block-right); bottom: 0; left: var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
      .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
      .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--soft-line); }
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
      .vivi-rendered-comment-block { --rendered-comment-block-left: 0px; --rendered-comment-block-right: 0px; --soft-line: rgba(24,32,47,.08); --panel: white; --palette: #fbfaf7; --comment-tint: rgba(126,87,194,.12); --comment-tint-active: rgba(126,87,194,.2); --comment-line: rgba(126,87,194,.35); --comment-text: #5e3aa3; isolation: isolate; position: relative; z-index: 0; border-radius: 8px; }
      .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: 0; inset: 0 var(--rendered-comment-block-right) 0 var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
      .vivi-rendered-comment-block:not(tr) > * { position: relative; z-index: 1; }
	      .vivi-rendered-comment-block.hover-rendered-comment-block:not(tr)::before, tr.vivi-rendered-comment-block.hover-rendered-comment-block { background: var(--soft-line); }
	      .has-rendered-comment:not(tr), .active-rendered-comment:not(tr), .drafting-rendered-comment:not(tr) { background: transparent; box-shadow: none; }
	      blockquote.vivi-rendered-comment-block.has-rendered-comment, blockquote.vivi-rendered-comment-block.drafting-rendered-comment, blockquote.vivi-rendered-comment-block.active-rendered-comment { border-left-color: transparent !important; }
	      .has-rendered-comment:not(tr)::before, .drafting-rendered-comment:not(tr)::before, tr.has-rendered-comment, tr.drafting-rendered-comment { background: linear-gradient(90deg, var(--comment-tint-active), color-mix(in srgb, var(--comment-tint) 56%, transparent) 68%, transparent); box-shadow: inset 2px 0 0 var(--comment-line); }
      .active-rendered-comment:not(tr)::before, tr.active-rendered-comment { background: linear-gradient(90deg, color-mix(in srgb, var(--comment-tint-active) 86%, white), var(--comment-tint) 72%, transparent); box-shadow: inset 3px 0 0 var(--comment-text), 0 0 0 1px color-mix(in srgb, var(--comment-line) 46%, transparent); }
      .rendered-comment-range-start.has-rendered-comment, .rendered-comment-range-start.drafting-rendered-comment { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
      .rendered-comment-range-middle.has-rendered-comment, .rendered-comment-range-middle.drafting-rendered-comment { border-radius: 0; }
      .rendered-comment-range-end.has-rendered-comment, .rendered-comment-range-end.drafting-rendered-comment { border-top-left-radius: 0; border-top-right-radius: 0; }
      .rendered-comment-range-join-after:not(tr)::after { content: ""; position: absolute; z-index: 1; left: var(--rendered-comment-block-left); right: var(--rendered-comment-block-right); top: 100%; height: var(--rendered-comment-join-after, 0); pointer-events: none; background: linear-gradient(90deg, var(--comment-tint-active), color-mix(in srgb, var(--comment-tint) 56%, transparent) 68%, transparent); }
      .active-rendered-comment.rendered-comment-range-join-after:not(tr)::after { background: linear-gradient(90deg, color-mix(in srgb, var(--comment-tint-active) 86%, white), var(--comment-tint) 72%, transparent); }
      .rendered-comment-marker { position: absolute; right: 8px; top: 50%; width: 20px; height: 20px; border: 1px solid var(--comment-line); border-radius: 6px; background: var(--panel); color: var(--comment-text); transform: translateY(-50%); cursor: pointer; }
      .rendered-comment-marker-count { position: absolute; right: -5px; top: -6px; min-width: 13px; height: 13px; border: 1px solid var(--comment-line); border-radius: 999px; background: var(--palette); color: var(--comment-text); font-size: 8px; font-weight: 800; line-height: 13px; }
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
