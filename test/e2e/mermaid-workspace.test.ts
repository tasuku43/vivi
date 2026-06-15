import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { FsNode } from "../../src/domain/fs-node.js";
import { ViewerService } from "../../src/app/viewer-service.js";
import { NodeFileSystem } from "../../src/infra/node-file-system.js";
import { startHttpServer } from "../../src/server/http-server.js";

let server: { url: string; close: () => Promise<void> } | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

it("keeps the Mermaid example workspace usable across mmd, markdown, and html previews", async () => {
  const rootDir = path.resolve("examples/mermaid-workspace");
  const service = new ViewerService({
    fileSystem: new NodeFileSystem({ rootDir }),
  });
  server = await startHttpServer({ host: "127.0.0.1", port: 0, service });

  const tree = await fetch(`${server.url}/api/tree`).then(
    (res) => res.json() as Promise<{ nodes: FsNode[] }>,
  );
  expect(flattenFiles(tree.nodes).map((file) => file.path).sort()).toEqual([
    "README.md",
    "docs/flow.mmd",
    "docs/notes.md",
    "public/embedded.html",
    "public/style.css",
  ]);

  const standalone = await fetch(
    `${server.url}/api/file?path=${encodeURIComponent("docs/flow.mmd")}`,
  ).then((res) => res.json());
  expect(standalone.viewerKind).toBe("mermaid");
  expect(standalone.content).toContain("sequenceDiagram");

  const markdown = await fetch(
    `${server.url}/api/file?path=${encodeURIComponent("docs/notes.md")}`,
  ).then((res) => res.json());
  expect(markdown.viewerKind).toBe("markdown");
  expect(markdown.content).toContain("```mermaid");
  expect(markdown.content).toContain("Return safe SVG");

  const html = await fetch(
    `${server.url}/preview/html?path=${encodeURIComponent("public/embedded.html")}`,
  );
  expect(html.status).toBe(200);
  const csp = html.headers.get("content-security-policy") ?? "";
  expect(csp).toContain("script-src 'nonce-");
  expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  const previewHtml = await html.text();
  expect(previewHtml).toContain("data-pathlens-mermaid-preview");
  expect(previewHtml).toContain('data-pathlens-html-theme="dark"');
  expect(previewHtml).toContain("background:#0e1316");
  expect(previewHtml).toContain('"primaryTextColor":"#edf7f5"');
  expect(previewHtml).toContain("/pathlens/vendor/mermaid.min.js");
  expect(previewHtml).toContain("data-pathlens-html-mermaid");
  expect(previewHtml).toContain('<figure class="html-mermaid"');
  expect(previewHtml).toContain("Open embedded.html");
  expect(previewHtml).toContain("Render with official Mermaid");
  expect(previewHtml).toContain("Diagram remains inspectable");

  const mermaidBundle = await fetch(`${server.url}/pathlens/vendor/mermaid.min.js`);
  expect(mermaidBundle.status).toBe(200);
  expect(mermaidBundle.headers.get("content-type")).toContain("text/javascript");
  expect(await mermaidBundle.text()).toContain('globalThis["mermaid"]');

  const lightHtml = await fetch(
    `${server.url}/preview/html?path=${encodeURIComponent("public/embedded.html")}&theme=light`,
  ).then((res) => res.text());
  expect(lightHtml).toContain('data-pathlens-html-theme="light"');
  expect(lightHtml).toContain("background:#fbfaf7");
  expect(lightHtml).toContain('"primaryTextColor":"#172426"');

  await server.close();
  server = null;

  const scriptsEnabledService = new ViewerService({
    fileSystem: new NodeFileSystem({
      rootDir,
      allowHtmlScripts: true,
    }),
  });
  server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    service: scriptsEnabledService,
    allowHtmlScripts: true,
  });

  const scriptsEnabledPreview = await fetch(
    `${server.url}/preview/html?path=${encodeURIComponent("public/embedded.html")}`,
  );
  expect(scriptsEnabledPreview.status).toBe(200);
  expect(scriptsEnabledPreview.headers.get("content-security-policy")).toContain(
    "script-src 'self' 'unsafe-inline'",
  );
  const scriptsEnabledHtml = await scriptsEnabledPreview.text();
  expect(scriptsEnabledHtml).toContain("data-pathlens-html-mermaid");
  expect(scriptsEnabledHtml).toContain("Mermaid preview · user scripts active");
  expect(scriptsEnabledHtml).toContain("/pathlens/vendor/mermaid.min.js");
  expect(scriptsEnabledHtml).toContain("Render with official Mermaid");
});

function flattenFiles(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) =>
    node.kind === "directory" ? flattenFiles(node.children ?? []) : [node],
  );
}
