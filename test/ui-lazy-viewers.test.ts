import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const fileViewerSource = readFileSync(
  new URL(
    "../ui/src/features/file-context/components/FileViewer.tsx",
    import.meta.url,
  ),
  "utf8",
);
const appSource = readFileSync(
  new URL("../ui/src/app/App.tsx", import.meta.url),
  "utf8",
);
const lightGraphqlClientSource = readFileSync(
  new URL(
    "../ui/src/infrastructure/vivi-api/lightGraphqlViviClient.ts",
    import.meta.url,
  ),
  "utf8",
);

it("keeps heavyweight file viewers out of the initial UI bundle", () => {
  expect(fileViewerSource).not.toMatch(
    /import\s+\{\s*(MarkdownViewer|HtmlViewer|CodeViewer|MermaidViewer)\s*\}\s+from\s+["']\.\.\/viewers\//,
  );
  expect(fileViewerSource).toContain('import("../viewers/MarkdownViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/HtmlViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/CodeViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/MermaidViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/CsvViewer.js")');
  expect(fileViewerSource).toContain('import("../viewers/DiffViewer.js")');
  expect(fileViewerSource).not.toMatch(
    /import\s+\{\s*(CsvViewer|DiffViewer)\s*\}\s+from\s+["']\.\.\/viewers\//,
  );
});

it("keeps generated GraphQL document objects out of the initial UI bundle", () => {
  expect(appSource).toContain("LightGraphqlViviClient");
  expect(appSource).not.toMatch(
    /import\s+\{\s*GraphqlViviClient\s*\}\s+from\s+["']\.\.\/infrastructure\/vivi-api\/graphqlViviClient\.js["']/,
  );
  expect(lightGraphqlClientSource).not.toMatch(
    /import\s+\{\s*GraphqlViviClient\s*\}\s+from\s+["']\.\/graphqlViviClient\.js["']/,
  );
  expect(lightGraphqlClientSource).not.toContain('from "graphql"');
  expect(lightGraphqlClientSource).not.toContain("Document");
  expect(lightGraphqlClientSource).toContain('this.url("/graphql")');
});
