import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import type { FilePayload } from "../../../domain/fs-node.js";
import {
  commentsForPath,
  sampleFiles,
} from "../../../storybook/fixtures/review-lab.js";
import {
  extractHtmlOutline,
  extractMarkdownOutline,
} from "../../../state/outline.js";
import { FileViewer } from "./FileViewer.js";
import styles from "./FileViewer.module.css";

const meta = {
  title: "Files/Viewer Coverage States",
  component: FileViewer,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: "100vh", background: "#090d15" }}>
        <Story />
      </div>
    ),
  ],
  args: {
    file: sampleFiles.unknownText,
    allowHtmlScripts: false,
    theme: "light",
    selectedCodeRange: null,
    comments: [],
    onCodeSelectionChange: () => undefined,
    onViewerModeChange: () => undefined,
    onDiffToggle: () => undefined,
    onCreateComment: () => undefined,
    onOpenComment: () => undefined,
    onCloseComment: () => undefined,
    onCommentStatusChange: () => undefined,
  },
} satisfies Meta<typeof FileViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownTextFallback: Story = {};

export const MarkdownKnownViewer: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    comments: commentsForPath(sampleFiles.markdown.path),
  },
};

export const MarkdownWithLocalOutline: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    outline: extractMarkdownOutline(sampleFiles.markdown.content),
    comments: commentsForPath(sampleFiles.markdown.path),
    onOutlineSelect: () => undefined,
  },
};

export const MarkdownWithOpenLocalOutline: Story = {
  args: {
    file: sampleFiles.markdown,
    viewerMode: "rendered",
    defaultOutlineOpen: true,
    outline: extractMarkdownOutline(sampleFiles.markdown.content),
    comments: commentsForPath(sampleFiles.markdown.path),
    onOutlineSelect: () => undefined,
  },
};

export const CodeWithLocalOutline: Story = {
  tags: ["interaction"],
  args: {
    file: sampleFiles.code,
    theme: "dark",
    selectedCodeRange: { start: 4, end: 4 },
    comments: commentsForPath(sampleFiles.code.path),
    reviewState: "queued",
    onMarkReviewed: () => undefined,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const reviewState = canvasElement.querySelector(
        ".file-location-segment .review-state-label",
      );
      expect(reviewState).toBeInTheDocument();
      expect(reviewState).toHaveTextContent("Queued");
      expect(reviewState).toHaveAttribute(
        "aria-label",
        "Review state: Queued",
      );
      expect(canvasElement.querySelector(".mark-reviewed-button")).toHaveTextContent(
        "Mark as reviewed",
      );
    });
  },
};

export const CodeWithOpenLocalOutline: Story = {
  args: {
    file: sampleFiles.code,
    theme: "dark",
    defaultOutlineOpen: true,
    selectedCodeRange: { start: 4, end: 4 },
  },
};

export const HtmlKnownViewer: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "preview",
    comments: commentsForPath(sampleFiles.html.path),
  },
};

export const HtmlWithOpenLocalOutline: Story = {
  args: {
    file: sampleFiles.html,
    viewerMode: "preview",
    defaultOutlineOpen: true,
    outline: extractHtmlOutline(sampleFiles.html.content),
    comments: commentsForPath(sampleFiles.html.path),
    onOutlineSelect: () => undefined,
  },
};

export const JsonKnownViewer: Story = {
  args: {
    file: sampleFiles.json,
  },
};

export const CsvTableFallback: Story = {
  args: {
    file: sampleFiles.csv,
  },
};

export const MermaidKnownViewer: Story = {
  args: {
    file: sampleFiles.mermaid,
  },
};

export const ImageKnownViewer: Story = {
  args: {
    file: sampleFiles.image,
  },
};

export const BinaryMetadata: Story = {
  args: {
    file: sampleFiles.binary,
  },
};

export const LargeTextLimitedPreview: Story = {
  args: {
    file: sampleFiles.largeText,
  },
};

export const LargeBinaryMetadata: Story = {
  args: {
    file: sampleFiles.largeBinary,
  },
};

export const ViewerToolbarChromeConsistency: Story = {
  tags: ["interaction"],
  render: (args) => {
    const files = [
      sampleFiles.markdown,
      sampleFiles.html,
      sampleFiles.code,
      sampleFiles.unknownText,
      sampleFiles.json,
    ];
    return (
      <div
        style={{
          display: "grid",
          gap: 16,
          padding: 16,
          background: "#090d15",
        }}
      >
        {files.map((file) => (
          <div
            key={file.path}
            style={{
              height: 220,
              overflow: "auto",
              border: "1px solid var(--line)",
            }}
          >
            <FileViewer
              {...args}
              file={file}
              viewerMode={
                file.viewerKind === "html" ? "preview" : args.viewerMode
              }
              selectedCodeRange={
                file.viewerKind === "code" ? { start: 4, end: 4 } : null
              }
              theme={file.viewerKind === "code" ? "dark" : args.theme}
              comments={commentsForPath(file.path)}
            />
          </div>
        ))}
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    await waitFor(
      () => {
        expect(
          canvasElement.querySelectorAll(
            ".file-viewer-frame > section > .viewer-toolbar",
          ),
        ).toHaveLength(5);
      },
      { timeout: 5000 },
    );

    const toolbars = Array.from(
      canvasElement.querySelectorAll<HTMLElement>(
        ".file-viewer-frame > section > .viewer-toolbar",
      ),
    );
    expect(canvasElement.querySelectorAll(".file-location-bar")).toHaveLength(
      0,
    );
    expect(canvasElement.querySelectorAll(".file-location-kind")).toHaveLength(
      0,
    );
    const firstHeight = toolbars[0]?.getBoundingClientRect().height ?? 0;
    expect(firstHeight).toBeGreaterThan(0);

    for (const toolbar of toolbars) {
      const location = toolbar.querySelector<HTMLElement>(
        ":scope > .viewer-toolbar-location",
      );
      const actions = toolbar.querySelector<HTMLElement>(
        ":scope > .viewer-toolbar-actions",
      );
      expect(location).toBeTruthy();
      expect(actions).toBeTruthy();
      expect(
        Math.abs(toolbar.getBoundingClientRect().height - firstHeight),
      ).toBeLessThanOrEqual(2);
      expect(toolbar.lastElementChild).toBe(actions);
    }

    expect(canvasElement.textContent ?? "").not.toContain("Read-only");
  },
};

export const ViewerToolbarStickyByExtension: Story = {
  tags: ["interaction"],
  render: (args) => (
    <div className={`${styles.toolbarStickyMatrix} toolbar-sticky-matrix`}>
      {toolbarStickyCases.map((item) => (
        <section
          aria-label={`${item.extension} sticky toolbar case`}
          className={`${styles.toolbarStickyCase} toolbar-sticky-case`}
          data-toolbar-sticky-case={item.extension}
          key={item.extension}
        >
          <header>
            <strong>{item.extension}</strong>
            <span>{item.file.path}</span>
          </header>
          <div className={`${styles.toolbarStickyScroll} toolbar-sticky-scroll`}>
            <FileViewer
              {...args}
              file={item.file}
              viewerMode={item.viewerMode}
              selectedCodeRange={
                item.file.viewerKind === "code" ? { start: 12, end: 12 } : null
              }
              theme={item.file.viewerKind === "code" ? "dark" : args.theme}
              comments={commentsForPath(item.file.path)}
            />
          </div>
        </section>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(
        canvasElement.querySelectorAll("[data-toolbar-sticky-case]"),
      ).toHaveLength(toolbarStickyCases.length);
      expect(
        canvasElement.querySelectorAll(
          "[data-toolbar-sticky-case] .file-viewer-frame > section > .viewer-toolbar",
        ),
      ).toHaveLength(toolbarStickyCases.length);
      expect(canvasElement.querySelectorAll(".file-location-bar")).toHaveLength(
        0,
      );
      expect(
        canvasElement.querySelectorAll(".file-location-kind"),
      ).toHaveLength(0);
    });
    expect(canvasElement.textContent ?? "").not.toContain("Read-only");

    for (const item of toolbarStickyCases) {
      const caseElement = canvasElement.querySelector<HTMLElement>(
        `[data-toolbar-sticky-case="${item.extension}"]`,
      );
      expect(caseElement).toBeTruthy();
      if (!caseElement) continue;
      const scrollBox = caseElement.querySelector<HTMLElement>(
        ".toolbar-sticky-scroll",
      );
      const toolbar = caseElement.querySelector<HTMLElement>(
        ".file-viewer-frame > section > .viewer-toolbar",
      );
      const toolbarLocation = caseElement.querySelector<HTMLElement>(
        ".file-viewer-frame > section > .viewer-toolbar .viewer-toolbar-location",
      );
      expect(scrollBox).toBeTruthy();
      expect(toolbar).toBeTruthy();
      expect(toolbarLocation).toBeTruthy();
      if (!scrollBox || !toolbar || !toolbarLocation) continue;
      expect(toolbarLocation.textContent ?? "").toContain(
        item.file.path.split("/").at(-1) ?? item.file.path,
      );

      scrollBox.scrollTop = 120;
      scrollBox.dispatchEvent(new Event("scroll", { bubbles: true }));

      await waitFor(() => {
        const scrollTop = scrollBox.getBoundingClientRect().top;
        const toolbarRect = toolbar.getBoundingClientRect();
        expect(Math.abs(toolbarRect.top - scrollTop)).toBeLessThanOrEqual(1);
        expect(toolbarRect.bottom).toBeGreaterThan(scrollTop + 24);
      });
    }
  },
};

const toolbarStickyCases = [
  {
    extension: ".md",
    file: storyFileWithContent(
      sampleFiles.markdown,
      "docs/sticky-toolbar.md",
      Array.from({ length: 16 }, (_, index) =>
        [
          `# Sticky Markdown ${index + 1}`,
          "",
          "Rendered Markdown should keep the viewer toolbar pinned while review content scrolls.",
        ].join("\n"),
      ).join("\n\n"),
    ),
    viewerMode: "rendered" as const,
  },
  {
    extension: ".html",
    file: storyFileWithContent(
      sampleFiles.html,
      "preview/sticky-toolbar.html",
      [
        "<!doctype html>",
        "<html>",
        "  <body>",
        ...Array.from(
          { length: 24 },
          (_, index) =>
            `    <p>HTML preview row ${index + 1}: the toolbar remains pinned.</p>`,
        ),
        "  </body>",
        "</html>",
      ].join("\n"),
    ),
    viewerMode: "preview" as const,
  },
  {
    extension: ".ts",
    file: storyFileWithContent(
      sampleFiles.code,
      "test/cli-args.test.ts",
      Array.from(
        { length: 80 },
        (_, index) =>
          `export const stickyToolbarCase${index + 1}: number = ${index + 1};`,
      ).join("\n"),
    ),
  },
  {
    extension: ".go",
    file: storyFileWithContent(
      sampleFiles.code,
      "server/review_cli.go",
      Array.from(
        { length: 80 },
        (_, index) =>
          `func stickyToolbarCase${index + 1}() int { return ${index + 1} }`,
      ).join("\n"),
    ),
  },
  {
    extension: ".json",
    file: storyFileWithContent(
      sampleFiles.json,
      "reports/sticky-toolbar.json",
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 36 }, (_, index) => [
            `check_${index + 1}`,
            { status: "pass", durationMs: 100 + index },
          ]),
        ),
        null,
        2,
      ),
    ),
  },
  {
    extension: ".csv",
    file: storyFileWithContent(
      sampleFiles.csv,
      "reports/sticky-toolbar.csv",
      [
        "name,status,durationMs",
        ...Array.from(
          { length: 48 },
          (_, index) => `check-${index + 1},pass,${120 + index}`,
        ),
      ].join("\n"),
    ),
  },
  {
    extension: ".mmd",
    file: storyFileWithContent(
      sampleFiles.mermaid,
      "docs/sticky-toolbar.mmd",
      [
        "flowchart TD",
        ...Array.from(
          { length: 34 },
          (_, index) => `  Node${index} --> Node${index + 1}`,
        ),
      ].join("\n"),
    ),
  },
  {
    extension: ".txt",
    file: storyFileWithContent(
      sampleFiles.unknownText,
      "logs/sticky-toolbar.txt",
      Array.from(
        { length: 72 },
        (_, index) => `line ${index + 1}: plain text toolbar remains pinned`,
      ).join("\n"),
    ),
  },
];

function storyFileWithContent(
  base: FilePayload,
  path: string,
  content: string,
): FilePayload {
  return {
    ...base,
    path,
    content,
    etag: `etag:${path}:sticky-toolbar`,
    size: new TextEncoder().encode(content).byteLength,
  };
}
