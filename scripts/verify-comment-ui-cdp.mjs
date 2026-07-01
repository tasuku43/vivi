#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ViewerService } from "../dist/app/viewer-service.js";
import { NodeCommentStore } from "../dist/infra/node-comment-store.js";
import { GitChangeReview } from "../dist/infra/git-change-review.js";
import { NodeFileSystem } from "../dist/infra/node-file-system.js";
import { startHttpServer } from "../dist/server/http-server.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let server;
let chrome;
let cdp;
let dataDir;
let chromeDir;

try {
  dataDir = await mkdtemp(path.join(tmpdir(), "vivi-comment-ui-data-"));
  chromeDir = await mkdtemp(path.join(tmpdir(), "vivi-comment-ui-chrome-"));
  server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    service: new ViewerService({
      fileSystem: new NodeFileSystem({ rootDir: repoRoot }),
      changeReview: new GitChangeReview({ rootDir: repoRoot }),
      commentStore: new NodeCommentStore({ dataDir }),
    }),
  });

  const debugPort = await freePort();
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDir}`,
    server.url,
  ]);
  chrome.stderr?.setEncoding("utf8");
  chrome.stderr?.on("data", (chunk) => {
    if (process.env.VIVI_COMMENT_UI_DEBUG) process.stderr.write(chunk);
  });

  const wsUrl = await waitForDevtools(debugPort);
  cdp = await connectCdp(wsUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: server.url });
  await waitForExpression(
    () => document.body?.innerText?.includes("vivi"),
    10_000,
  );

  await openTreeFile("Dockerfile");
  await waitForExpression(
    () => document.querySelectorAll(".code-line").length > 20,
    10_000,
  );
  await waitForExpression(
    () => Boolean(document.querySelector(".line-code span[style]")),
    10_000,
  );
  await selectElementText('.code-line[data-line="19"] .line-code', 24);
  await waitForExpression(
    () => Boolean(document.querySelector(".code-comment-thread")),
    5_000,
  );
  const partialCodeSelection = await pageValue(() => ({
    selectedLines: [...document.querySelectorAll(".code-line.selected")].map(
      (row) => row.dataset.line,
    ),
    threadLabel: document
      .querySelector(".code-comment-thread")
      ?.getAttribute("aria-label"),
    floatingComposer: Boolean(
      document.querySelector(".selection-comment-composer"),
    ),
    nativeSelection: window.getSelection()?.toString() ?? "",
  }));
  assert(
    partialCodeSelection.selectedLines.join(",") === "19",
    `partial code selection did not anchor line 19: ${JSON.stringify(partialCodeSelection)}`,
  );
  assert(
    partialCodeSelection.threadLabel === "Comment thread for line 19",
    `partial code selection did not open an inline thread: ${JSON.stringify(partialCodeSelection)}`,
  );
  assert(
    !partialCodeSelection.floatingComposer &&
      partialCodeSelection.nativeSelection === "",
    `partial code selection kept the legacy/native highlight: ${JSON.stringify(partialCodeSelection)}`,
  );
  await closeCodeCommentThread("partial code selection");

  await dragSelectLineRange(13, 18);
  await waitForExpression(
    () =>
      document
        .querySelector(".code-comment-thread")
        ?.getAttribute("aria-label") === "Comment thread for lines 13-18",
    5_000,
  );
  const rangedCodeSelection = await pageValue(() => ({
    selectedLines: [...document.querySelectorAll(".code-line.selected")].map(
      (row) => row.dataset.line,
    ),
    threadAfterFinalLine: Boolean(
      document
        .querySelector('.code-line[data-line="18"]')
        ?.nextElementSibling?.querySelector(".code-comment-thread"),
    ),
    floatingComposer: Boolean(
      document.querySelector(".selection-comment-composer"),
    ),
  }));
  assert(
    rangedCodeSelection.selectedLines.join(",") === "13,14,15,16,17,18",
    `line drag did not preserve the full range: ${JSON.stringify(rangedCodeSelection)}`,
  );
  assert(
    rangedCodeSelection.threadAfterFinalLine &&
      !rangedCodeSelection.floatingComposer,
    `line drag did not insert the inline thread after line 18: ${JSON.stringify(rangedCodeSelection)}`,
  );
  await closeCodeCommentThread("ranged code selection");

  await clickElement(
    () =>
      [...document.querySelectorAll("button")].find(
        (button) =>
          button.textContent?.includes("AGENTS.md") &&
          !button.textContent?.includes("preview"),
      ),
    "AGENTS.md tree item",
  );
  await waitForExpression(
    () => document.body.innerText.includes("Inspector target\nAGENTS.md"),
    10_000,
  );
  await clickElement(
    () =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Source",
      ),
    "Source segmented control",
  );
  await waitForExpression(
    () =>
      document.querySelectorAll(".source-comment-surface .code-line").length >
      20,
    10_000,
  );

  await selectElementText(
    '.source-comment-surface .code-line[data-line="3"] .line-code',
    260,
  );
  await waitForExpression(
    () => Boolean(document.querySelector(".code-comment-thread")),
    5_000,
  );
  const composerState = await pageValue(() => {
    const standaloneButtons = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "Comment",
    ).length;
    return {
      threadLabel: document
        .querySelector(".code-comment-thread")
        ?.getAttribute("aria-label"),
      selectedLines: [...document.querySelectorAll(".code-line.selected")].map(
        (row) => row.dataset.line,
      ),
      floatingComposer: Boolean(
        document.querySelector(".selection-comment-composer"),
      ),
      standaloneButtons,
    };
  });
  assert(
    composerState.threadLabel === "Comment thread for line 3" &&
      composerState.selectedLines.join(",") === "3" &&
      !composerState.floatingComposer,
    `Markdown source did not normalize selection into an inline thread: ${JSON.stringify(composerState)}`,
  );
  assert(
    composerState.standaloneButtons === 0,
    "standalone Comment button is still visible",
  );
  const saveDisabledInitially = await pageValue(() =>
    Boolean(document.querySelector(".code-comment-submit")?.disabled),
  );
  assert(saveDisabledInitially, "empty comment body should disable Save");

  const commentBody = "CDP browser selected-text comment\nsecond line";
  await cdp.send("Input.insertText", {
    text: "CDP browser selected-text comment",
  });
  await pressEnter();
  await cdp.send("Input.insertText", {
    text: "second line",
  });
  const textareaValue = await pageValue(
    () => document.querySelector(".code-comment-thread textarea")?.value,
  );
  assert(
    textareaValue === commentBody,
    `plain Enter should insert a newline, got ${JSON.stringify(textareaValue)}`,
  );
  await pressEnter({ shift: true });
  const created = await waitForApiComment(commentBody, 10_000);
  assert(
    created.anchor?.canonical?.quote?.includes("This repository is a scaffold"),
    `saved comment did not preserve selected quote: ${JSON.stringify(created)}`,
  );
  await waitForExpression(
    () =>
      document.querySelectorAll(".code-line-comment-action.has-thread").length >
        0 &&
      document.querySelectorAll(".has-comment").length > 0 &&
      document
        .querySelector(".code-comment-thread")
        ?.textContent?.includes("CDP browser selected-text comment") &&
      !document.querySelector(".inline-comment-card"),
    10_000,
  );
  const savedState = await pageValue(() => ({
    markers: document.querySelectorAll(".code-line-comment-action.has-thread")
      .length,
    highlights: document.querySelectorAll(".has-comment").length,
    inlineThread: document.querySelector(".code-comment-thread")?.innerText,
    inspector: document.querySelector(".inspector")?.innerText,
  }));
  assert(savedState.markers > 0, "saved comment marker is missing");
  assert(savedState.highlights > 0, "saved comment highlight is missing");
  assert(
    savedState.inlineThread?.includes("CDP browser selected-text comment"),
    "inline thread did not show the saved Markdown source comment",
  );
  assert(
    !savedState.inspector?.includes("CDP browser selected-text comment"),
    "Inspector still duplicates full comment body",
  );

  const sourceShot = await screenshot("source-inline");

  await closeCodeCommentThread("Markdown source inline comment");

  await openTreeFile("README.md");
  await waitForExpression(
    () => document.body.innerText.includes("Inspector target\nREADME.md"),
    10_000,
  );
  await clickElement(
    () =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Rendered",
      ),
    "Rendered segmented control",
  );
  await waitForExpression(
    () => Boolean(document.querySelector(".markdown-document")),
    10_000,
  );
  const renderedActions = await pageValue(() => ({
    blocks: document.querySelectorAll(".vivi-rendered-comment-block").length,
    markers: document.querySelectorAll(".rendered-comment-marker").length,
  }));
  assert(renderedActions.blocks > 0, "rendered Markdown has no comment blocks");
  assert(
    renderedActions.markers === 0,
    `rendered Markdown still shows redundant comment markers: ${JSON.stringify(renderedActions)}`,
  );
  await selectElementText(".markdown-document p", 60);
  await waitForExpression(
    () =>
      Boolean(
        document.querySelector(
          ".rendered-comment-thread-host .code-comment-thread",
        ),
      ) &&
      !document.querySelector(".selection-comment-composer") &&
      Boolean(document.querySelector(".drafting-rendered-comment")),
    5_000,
  );
  await clickElement(
    () => document.querySelector(".rendered-comment-thread textarea"),
    "rendered Markdown comment textarea",
  );
  await cdp.send("Input.insertText", {
    text: "CDP rendered markdown comment",
  });
  await pressEnter({ shift: true });
  const renderedMarkdownComment = await waitForApiComment(
    "CDP rendered markdown comment",
    10_000,
    "README.md",
  );
  assert(
    renderedMarkdownComment.anchor?.surface === "rendered",
    `rendered Markdown comment did not keep rendered anchor: ${JSON.stringify(
      renderedMarkdownComment,
    )}`,
  );
  assert(
    renderedMarkdownComment.anchor?.canonical?.quote,
    "rendered Markdown comment did not preserve selected quote",
  );
  assert(
    renderedMarkdownComment.anchor?.canonical?.lineStart === 3 &&
      renderedMarkdownComment.anchor?.canonical?.lineEnd === 3,
    `rendered Markdown comment did not preserve its source line: ${JSON.stringify(renderedMarkdownComment)}`,
  );
  await waitForExpression(
    () =>
      Boolean(document.querySelector(".has-rendered-comment")) &&
      document
        .querySelector(".rendered-comment-thread")
        ?.textContent?.includes("CDP rendered markdown comment") &&
      !document.querySelector(".inline-comment-card") &&
      document
        .querySelector('.rendered-comment-marker[data-comment-count="1"]')
        ?.getAttribute("aria-label") === "Open comment thread with 1 message",
    5_000,
  );
  await closeCodeCommentThread("rendered Markdown thread");
  await clickElement(
    () => document.querySelector(".rendered-comment-marker"),
    "rendered Markdown comment marker",
  );
  await waitForExpression(
    () =>
      document
        .querySelector(".rendered-comment-thread")
        ?.textContent?.includes("CDP rendered markdown comment"),
    5_000,
  );
  await clickElement(
    () => document.querySelector(".rendered-comment-thread textarea"),
    "rendered Markdown reply textarea before Escape",
  );
  await pressEscape();
  await waitForExpression(
    () => !document.querySelector(".rendered-comment-thread"),
    2_000,
  );
  await clickElement(
    () => document.querySelector(".rendered-comment-marker"),
    "rendered Markdown comment marker after Escape",
  );
  await waitForExpression(
    () =>
      document
        .querySelector(".rendered-comment-thread")
        ?.textContent?.includes("CDP rendered markdown comment"),
    5_000,
  );
  await pageValue(() => {
    const textarea = document.querySelector(
      ".rendered-comment-thread textarea",
    );
    textarea?.scrollIntoView({ block: "center" });
  });
  await delay(100);
  await clickElement(
    () => document.querySelector(".rendered-comment-thread textarea"),
    "rendered Markdown reply textarea",
  );
  await cdp.send("Input.insertText", {
    text: "CDP rendered thread reply",
  });
  await waitForExpression(() => {
    const button = document.querySelector(
      '.rendered-comment-thread [aria-label="Add reply"]',
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  }, 2_000);
  await clickElement(
    () =>
      document.querySelector(
        '.rendered-comment-thread [aria-label="Add reply"]',
      ),
    "rendered Markdown reply button",
  );
  await waitForApiComment("CDP rendered thread reply", 10_000, "README.md");
  await waitForExpression(
    () =>
      document
        .querySelector(".rendered-comment-thread")
        ?.textContent?.includes("CDP rendered thread reply") &&
      document
        .querySelector('.rendered-comment-marker[data-comment-count="2"]')
        ?.getAttribute("aria-label") === "Open comment thread with 2 messages",
    5_000,
  );
  const renderedShot = await screenshot("rendered-block-comment");
  const renderedThreadScroll = await pageValue(() => {
    const block = document.querySelector(".has-rendered-comment");
    const host = document.querySelector(".rendered-comment-thread-host");
    const scroller = document.querySelector(".viewer-pane");
    if (!block || !host || !(scroller instanceof HTMLElement)) return null;
    const beforeBlock = block.getBoundingClientRect();
    const beforeHost = host.getBoundingClientRect();
    const before = {
      hostTop: beforeHost.top,
      gap: beforeHost.top - beforeBlock.bottom,
      scrollTop: scroller.scrollTop,
    };
    scroller.scrollTop += 180;
    const afterBlock = block.getBoundingClientRect();
    const afterHost = host.getBoundingClientRect();
    return {
      before,
      after: {
        hostTop: afterHost.top,
        gap: afterHost.top - afterBlock.bottom,
        scrollTop: scroller.scrollTop,
      },
    };
  });
  assert(
    renderedThreadScroll &&
      renderedThreadScroll.after.scrollTop >
        renderedThreadScroll.before.scrollTop &&
      renderedThreadScroll.after.hostTop <
        renderedThreadScroll.before.hostTop - 100 &&
      Math.abs(
        renderedThreadScroll.after.gap - renderedThreadScroll.before.gap,
      ) < 2,
    `rendered thread did not stay with its block while scrolling: ${JSON.stringify(renderedThreadScroll)}`,
  );

  await activateMarkdownMode("Source");
  await waitForExpression(
    () => document.querySelectorAll(".markdown-source .code-line").length > 5,
    5_000,
  );
  const markdownSourceState = await pageValue(() => ({
    surfaces: document.querySelectorAll(".markdown-source").length,
    commentedLines: [
      ...document.querySelectorAll(".markdown-source .code-line.has-comment"),
    ].map((line) => line.getAttribute("data-line")),
    lineThreeClass: document
      .querySelector('.markdown-source .code-line[data-line="3"]')
      ?.getAttribute("class"),
  }));
  assert(
    markdownSourceState.commentedLines.includes("3"),
    `rendered Markdown comment was not projected onto source line 3: ${JSON.stringify(markdownSourceState)}`,
  );
  await pageValue(() => {
    const action = document.querySelector(
      ".markdown-source .code-line-comment-action.has-thread",
    );
    action?.scrollIntoView({ block: "center" });
  });
  await delay(100);
  await clickElement(
    () =>
      document.querySelector(
        ".markdown-source .code-line-comment-action.has-thread",
      ),
    "README source comment thread button",
  );
  await waitForExpression(
    () =>
      document
        .querySelector(".code-comment-thread")
        ?.textContent?.includes("CDP rendered markdown comment"),
    5_000,
  );
  await clickElement(
    () => document.querySelector(".code-comment-thread textarea"),
    "README source reply textarea",
  );
  await cdp.send("Input.insertText", {
    text: "CDP source comment visible in rendered",
  });
  await pressEnter({ shift: true });
  const sourceToRenderedComment = await waitForApiComment(
    "CDP source comment visible in rendered",
    10_000,
    "README.md",
  );
  assert(
    sourceToRenderedComment.anchor?.surface === "source" &&
      sourceToRenderedComment.anchor?.canonical?.lineStart,
    `Markdown source reply did not keep a canonical source anchor: ${JSON.stringify(sourceToRenderedComment)}`,
  );
  await activateMarkdownMode("Rendered");
  await waitForExpression(
    () => Boolean(document.querySelector(".markdown-document")),
    5_000,
  );
  await waitForExpression(
    () => Boolean(document.querySelector(".has-rendered-comment")),
    5_000,
  );
  await clickElement(
    () => document.querySelector(".has-rendered-comment"),
    "rendered Markdown block with source comments",
  );
  await waitForExpression(
    () =>
      document
        .querySelector(".rendered-comment-thread")
        ?.textContent?.includes("CDP source comment visible in rendered"),
    5_000,
  );
  const renderedProjectionState = await pageValue(() => ({
    highlightedBlocks: document.querySelectorAll(".has-rendered-comment")
      .length,
    threadComments: document.querySelectorAll(
      ".rendered-comment-thread .code-thread-comment",
    ).length,
    markers: document.querySelectorAll(".rendered-comment-marker").length,
    markerCount: document
      .querySelector(".rendered-comment-marker")
      ?.getAttribute("data-comment-count"),
    inlineCardOpen: Boolean(document.querySelector(".inline-comment-card")),
  }));
  assert(
    renderedProjectionState.threadComments === 3 &&
      renderedProjectionState.markers === 1 &&
      renderedProjectionState.markerCount === "3" &&
      !renderedProjectionState.inlineCardOpen,
    `source comment was not projected back onto its rendered block: ${JSON.stringify(renderedProjectionState)}`,
  );

  const panelState = await pageValue(() => ({
    panel: null,
    rowCount: document.querySelectorAll(
      ".rendered-comment-thread .code-thread-comment",
    ).length,
    inlineCardOpen: Boolean(document.querySelector(".inline-comment-card")),
    globalPanelOpen: Boolean(document.querySelector(".global-comments-panel")),
    text: document.body.innerText,
  }));
  assert(
    !panelState.globalPanelOpen,
    "legacy global comments panel is visible",
  );
  assert(
    panelState.rowCount === 3,
    "rendered comment thread should list three comments",
  );
  assert(!panelState.inlineCardOpen, "inline card overlaps rendered thread");
  assert(
    panelState.text?.includes("CDP rendered markdown comment"),
    "rendered thread did not list the rendered Markdown comment",
  );
  assert(
    panelState.text?.includes("CDP rendered thread reply"),
    "rendered thread did not list the rendered thread reply",
  );
  assert(
    panelState.text?.includes("CDP source comment visible in rendered"),
    "rendered thread did not list the Markdown source reply",
  );
  const panelShot = await screenshot("rendered-comment-thread");

  await openTreeFile("AGENTS.md");
  await waitForExpression(
    () =>
      document.body.innerText.includes("Inspector target") &&
      document.body.innerText.includes("Agent instructions"),
    10_000,
  );
  const clickedDiffButton = await pageValue(() => {
    const button = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Diff from HEAD",
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  });
  if (!clickedDiffButton) await pressShortcut("d", { meta: true });
  const diffOpened = await waitForCondition(
    () =>
      Boolean(document.querySelector(".diff-viewer")) &&
      document.body.innerText.includes("Available"),
    5_000,
  );
  let diffState = null;
  let diffShot = null;
  if (diffOpened) {
    diffState = await pageValue(() => ({
      inlineCardOpen: Boolean(document.querySelector(".inline-comment-card")),
      visibleCommentButtons: [...document.querySelectorAll("button")].filter(
        (button) => button.textContent?.trim() === "Comment",
      ).length,
      currentRows: document.querySelectorAll(
        ".diff-inline-row[data-current-line]",
      ).length,
      addedRows: document.querySelectorAll(
        ".diff-inline-row.add[data-current-line]",
      ).length,
      contextRows: document.querySelectorAll(
        ".diff-inline-row.context[data-current-line]",
      ).length,
      deletedRowsWithCurrentLine: document.querySelectorAll(
        ".diff-inline-row.remove[data-current-line]",
      ).length,
    }));
    assert(
      !diffState.inlineCardOpen,
      "inline comment card remained open after switching files",
    );
    assert(
      diffState.visibleCommentButtons === 0,
      "diff still contains visible per-line Comment buttons",
    );
    assert(diffState.currentRows > 0, "diff has no current-file comment rows");
    assert(diffState.addedRows > 0, "diff added lines are not commentable");
    assert(diffState.contextRows > 0, "diff context lines are not commentable");
    assert(
      diffState.deletedRowsWithCurrentLine === 0,
      "deleted diff rows are commentable",
    );
    diffShot = await screenshot("diff-no-buttons");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        commentId: created.id,
        screenshots: [sourceShot, renderedShot, panelShot, diffShot].filter(
          Boolean,
        ),
        composerState,
        savedState: {
          markers: savedState.markers,
          highlights: savedState.highlights,
        },
        panelState: {
          rowCount: panelState.rowCount,
          panel: panelState.panel,
        },
        diffState,
      },
      null,
      2,
    ),
  );
} finally {
  await cdp?.close().catch(() => undefined);
  if (chrome) {
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(1_000),
    ]);
  }
  await server?.close().catch(() => undefined);
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  if (chromeDir)
    await rm(chromeDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
}

async function clickElement(findElement, label) {
  const rect = await pageValue((source) => {
    const element = eval(`(${source})`)();
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, findElement.toString());
  assert(rect, `could not find ${label}`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  });
}

async function closeInlineComment(label) {
  await clickElement(
    () => document.querySelector('[aria-label="Close comment"]'),
    `${label} close button`,
  );
  const closed = await waitForCondition(
    () => !document.querySelector(".inline-comment-card"),
    2_000,
  );
  if (closed) return;

  const clicked = await pageValue(() => {
    const button = document.querySelector('[aria-label="Close comment"]');
    if (!(button instanceof HTMLElement)) return false;
    button.click();
    return true;
  });
  assert(clicked, `could not close ${label}`);
  await waitForExpression(
    () => !document.querySelector(".inline-comment-card"),
    5_000,
  );
}

async function closeCodeCommentThread(label) {
  const clicked = await pageValue(() => {
    const button = document.querySelector(
      '[aria-label="Close comment thread"]',
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  });
  assert(clicked, `could not close ${label}`);
  await waitForExpression(
    () => !document.querySelector(".code-comment-thread"),
    5_000,
  );
}

async function activateMarkdownMode(label) {
  const clicked = await pageValue((targetLabel) => {
    const control = document.querySelector(
      '.segmented-control[aria-label="Markdown view mode"]',
    );
    const button = [...(control?.querySelectorAll("button") ?? [])].find(
      (item) => item.textContent?.trim() === targetLabel,
    );
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  }, label);
  assert(clicked, `could not activate Markdown ${label} mode`);
}

async function openTreeFile(filePath) {
  const parts = filePath.split("/");
  let currentPath = "";
  for (const part of parts.slice(0, -1)) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const nextPath = parts.slice(0, parts.indexOf(part) + 2).join("/");
    if (!(await treePathVisible(nextPath))) {
      await clickTreePath(currentPath);
      await waitForTreePath(nextPath);
    }
  }
  if (!(await treePathVisible(filePath))) await waitForTreePath(filePath);
  await clickTreePath(filePath);
}

async function waitForTreePath(treePath) {
  await waitForExpression(
    (targetPath) =>
      Boolean(
        document.querySelector(`[data-tree-path="${CSS.escape(targetPath)}"]`),
      ),
    5_000,
    treePath,
  );
}

async function treePathVisible(treePath) {
  return await pageValue(
    (targetPath) =>
      Boolean(
        document.querySelector(`[data-tree-path="${CSS.escape(targetPath)}"]`),
      ),
    treePath,
  );
}

async function clickTreePath(treePath) {
  const clicked = await pageValue((targetPath) => {
    const element = document.querySelector(
      `[data-tree-path="${CSS.escape(targetPath)}"]`,
    );
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }, treePath);
  assert(clicked, `could not find tree path ${treePath}`);
}

async function dragSelectLine(lineNumber, width) {
  const rect = await pageValue((line) => {
    const element = document.querySelector(
      `.commented-source-line[data-line="${line}"] code`,
    );
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, lineNumber);
  assert(rect, `line ${lineNumber} was not visible`);
  const y = rect.top + rect.height / 2;
  const x1 = rect.left + 2;
  const x2 = Math.min(rect.left + width, rect.left + rect.width - 2);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: x1,
    y,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    x: x1,
    y,
  });
  for (const x of [x1 + 60, x1 + 140, x2]) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x,
      y,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    x: x2,
    y,
  });
  await delay(150);
  const observedSelection = await pageValue(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      text: selection.toString(),
    };
  });
  return observedSelection?.width
    ? observedSelection
    : { left: x1, top: rect.top, width: x2 - x1, height: rect.height };
}

async function dragSelectLineRange(startLine, endLine) {
  const points = await pageValue(
    ({ start, end }) => {
      const startElement = document.querySelector(
        `.code-line[data-line="${start}"] .line-number`,
      );
      startElement?.scrollIntoView({ block: "center", inline: "nearest" });
      const startRect = startElement?.getBoundingClientRect();
      const endRect = document
        .querySelector(`.code-line[data-line="${end}"] .line-number`)
        ?.getBoundingClientRect();
      if (!startRect || !endRect) return null;
      return {
        x: startRect.left + startRect.width / 2,
        startY: startRect.top + startRect.height / 2,
        endY: endRect.top + endRect.height / 2,
      };
    },
    { start: startLine, end: endLine },
  );
  assert(points, `lines ${startLine}-${endLine} were not visible`);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: points.x,
    y: points.startY,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    buttons: 1,
    clickCount: 1,
    x: points.x,
    y: points.startY,
  });
  const steps = Math.abs(endLine - startLine);
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      button: "left",
      buttons: 1,
      x: points.x,
      y: points.startY + ((points.endY - points.startY) * step) / steps,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    buttons: 0,
    clickCount: 1,
    x: points.x,
    y: points.endY,
  });
  await delay(150);
}

async function selectElementText(selector, maxCharacters) {
  const selection = await pageValue(
    ({ targetSelector, max }) => {
      const element = document.querySelector(targetSelector);
      if (!element) return null;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      const textNode = findTextNode(element);
      if (!textNode?.textContent) return null;
      const end = Math.min(textNode.textContent.length, max);
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const rect = range.getBoundingClientRect();
      element.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: rect.left + rect.width,
          clientY: rect.top + rect.height / 2,
        }),
      );
      return {
        text: selection?.toString() ?? "",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      function findTextNode(node) {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            return child;
          }
          const nested = findTextNode(child);
          if (nested) return nested;
        }
        return null;
      }
    },
    { targetSelector: selector, max: maxCharacters },
  );
  assert(selection?.text, `could not select text in ${selector}`);
  return selection;
}

async function pressEnter({ shift = false } = {}) {
  const modifiers = shift ? 8 : 0;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers,
  });
  if (!shift) {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "char",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      modifiers,
    });
  }
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers,
  });
}

async function pressEscape() {
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function pressShortcut(
  key,
  { ctrl = false, meta = false, shift = false },
) {
  let modifiers = 0;
  if (ctrl) modifiers |= 2;
  if (meta) modifiers |= 4;
  if (shift) modifiers |= 8;
  const upper = key.toUpperCase();
  await cdp.send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key: upper,
    code: `Key${upper}`,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    nativeVirtualKeyCode: upper.charCodeAt(0),
    modifiers,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: upper,
    code: `Key${upper}`,
    windowsVirtualKeyCode: upper.charCodeAt(0),
    nativeVirtualKeyCode: upper.charCodeAt(0),
    modifiers,
  });
}

async function screenshot(name) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const file = path.join(tmpdir(), `vivi-comment-ui-${name}.png`);
  await writeFile(file, Buffer.from(data, "base64"));
  return file;
}

async function waitForApiComment(body, timeoutMs, commentPath = "AGENTS.md") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const comments = await fetch(
      `${server.url}/api/v1/comments?path=${encodeURIComponent(commentPath)}`,
    ).then((response) => response.json());
    const match = comments.find((comment) => comment.body === body);
    if (match) return match;
    await delay(100);
  }
  throw new Error(`timed out waiting for comment body: ${body}`);
}

async function waitForExpression(fn, timeoutMs, arg) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await pageValue(fn, arg);
    if (lastValue) return lastValue;
    await delay(100);
  }
  throw new Error(`timed out waiting for expression; last=${lastValue}`);
}

async function waitForCondition(fn, timeoutMs, arg) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pageValue(fn, arg)) return true;
    await delay(100);
  }
  return false;
}

async function pageValue(fn, arg) {
  const expression =
    arg === undefined
      ? `(${fn.toString()})()`
      : `(${fn.toString()})(${JSON.stringify(arg)})`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Runtime.evaluate failed",
    );
  }
  return result.result.value;
}

async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result ?? {});
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const message = { id: ++id, method, params };
        pending.set(message.id, { resolve, reject });
        ws.send(JSON.stringify(message));
      });
    },
    close() {
      ws.close();
      return Promise.resolve();
    },
  };
}

async function waitForDevtools(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then(
        (response) => response.json(),
      );
      const page = tabs.find((tab) => tab.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chrome is still starting.
    }
    await delay(100);
  }
  throw new Error("timed out waiting for Chrome DevTools");
}

async function freePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("could not allocate free port"));
      });
    });
    server.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
