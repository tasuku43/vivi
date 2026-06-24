import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
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

function postHtmlDraftTarget(
  canvasElement: HTMLElement,
  target: {
    blockId: string;
    text: string;
    sourceLineStart: number;
    sourceLineEnd: number;
    rect: { left: number; top: number; width: number; height: number };
  },
): void {
  canvasElement.ownerDocument.defaultView?.postMessage(
    {
      type: "vivi-html-block-target",
      path: sampleFiles.html.path,
      blockId: target.blockId,
      blockIds: [target.blockId],
      selector: `[data-vivi-comment-block-id='${target.blockId}']`,
      text: target.text,
      sourceLineStart: target.sourceLineStart,
      sourceLineEnd: target.sourceLineEnd,
      rect: target.rect,
    },
    "*",
  );
}

export const SourceHtmlComment: Story = {
  tags: ["interaction"],
  args: {
    mode: "source",
    activeCommentId: "comment-html-rendered",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("list")).toBeInTheDocument();
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
};

export const MultiplePreviewDraftFormsStayOpen: Story = {
  tags: ["interaction"],
  args: {
    mode: "preview",
    comments: [],
    previewSrcDoc: htmlDraftPreviewStoryDocument(sampleFiles.html.path),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByTitle(sampleFiles.html.path),
    ).resolves.toBeInTheDocument();

    postHtmlDraftTarget(canvasElement, {
      blockId: "html-draft-h1",
      text: "Review Preview",
      sourceLineStart: 6,
      sourceLineEnd: 6,
      rect: { left: 28, top: 28, width: 704, height: 44 },
    });
    await waitFor(() =>
      expect(canvas.getAllByLabelText("New line comment")).toHaveLength(1),
    );

    postHtmlDraftTarget(canvasElement, {
      blockId: "html-draft-p",
      text: "Rendered HTML comments map back to source blocks.",
      sourceLineStart: 7,
      sourceLineEnd: 7,
      rect: { left: 28, top: 96, width: 704, height: 28 },
    });
    await waitFor(() =>
      expect(canvas.getAllByLabelText("New line comment")).toHaveLength(2),
    );
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

function htmlDraftPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 28px; font: 15px/1.6 Inter, system-ui, sans-serif; color: #172426; background: #fbfaf7; }
      .review-card { max-width: 760px; border: 1px solid #d4c9b8; border-radius: 8px; background: white; padding: 24px; }
      .vivi-rendered-comment-block { position: relative; border-radius: 8px; cursor: pointer; }
      .drafting-rendered-comment { outline: 2px solid #7e57c2; }
    </style>
  </head>
  <body>
    <main class="review-card">
      <h1 data-vivi-comment-block-id="html-draft-h1" data-vivi-source-line-start="6" data-vivi-source-line-end="6">Review Preview</h1>
      <p data-vivi-comment-block-id="html-draft-p" data-vivi-source-line-start="7" data-vivi-source-line-end="7">Rendered HTML comments map back to source blocks.</p>
    </main>
    <script>
      (() => {
        const path = ${JSON.stringify(path)};
        const blocks = Array.from(document.querySelectorAll("[data-vivi-comment-block-id]"));
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
        window.addEventListener("message", (event) => {
          if (event.source !== parent || event.data?.type !== "vivi-html-comments" || event.data.path !== path) return;
          const drafting = new Set(event.data.draftingBlockIds || []);
          blocks.forEach((block) => {
            block.className = "vivi-rendered-comment-block";
            if (drafting.has(block.dataset.viviCommentBlockId)) block.classList.add("drafting-rendered-comment");
          });
          if (Array.isArray(event.data.openBlockIdGroups)) {
            for (const group of event.data.openBlockIdGroups) {
              const block = blocks.find((item) => group.includes(item.dataset.viviCommentBlockId));
              if (block) postBlock(block);
            }
          }
        });
        blocks.forEach((block) => block.addEventListener("click", () => postBlock(block)));
      })();
    </script>
  </body>
</html>`;
}

function htmlCommentPreviewStoryDocument(path: string): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; padding: 28px; font: 15px/1.6 Inter, system-ui, sans-serif; color: #172426; background: #fbfaf7; }
      .review-card { max-width: 760px; border: 1px solid #d4c9b8; border-radius: 8px; background: white; padding: 24px; }
      .vivi-rendered-comment-block { --rendered-comment-block-left: -12px; --rendered-comment-block-right: -12px; --soft-line: rgba(24,32,47,.08); --panel: white; --palette: #fbfaf7; --comment-tint: rgba(126,87,194,.12); --comment-tint-active: rgba(126,87,194,.2); --comment-line: rgba(126,87,194,.35); --comment-text: #5e3aa3; isolation: isolate; position: relative; border-radius: 8px; }
      .vivi-rendered-comment-block:not(tr)::before { content: ""; position: absolute; z-index: -1; inset: 0 var(--rendered-comment-block-right) 0 var(--rendered-comment-block-left); border-radius: inherit; pointer-events: none; }
	      .vivi-rendered-comment-block:not(tr):hover::before, tr.vivi-rendered-comment-block:hover { background: var(--soft-line); }
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
        block.addEventListener("click", () => postTarget("vivi-html-comment-open", "comment-html-rendered"));
      })();
    </script>
  </body>
</html>`;
}
