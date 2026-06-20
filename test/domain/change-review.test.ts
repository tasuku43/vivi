import { expect, it } from "vitest";
import {
  buildAddedFileDiff,
  buildFullFileDiff,
  parseGitPorcelainStatus,
  statusFromCode,
} from "../../server/typescript/domain/change-review.js";

it("parses porcelain status into review changes", () => {
  const output = [
    " M README.md",
    "A  reports/new.csv",
    " D old.log",
    "R  docs/new.md",
    "docs/old.md",
    "?? screenshots/shot.png",
    "",
  ].join("\0");

  expect(parseGitPorcelainStatus(output)).toEqual([
    { path: "docs/new.md", originalPath: "docs/old.md", status: "renamed" },
    { path: "old.log", status: "deleted" },
    { path: "README.md", status: "modified" },
    { path: "reports/new.csv", status: "added" },
    { path: "screenshots/shot.png", status: "added" },
  ]);
});

it("maps status code precedence to readable statuses", () => {
  expect(statusFromCode("??")).toBe("added");
  expect(statusFromCode(" M")).toBe("modified");
  expect(statusFromCode("D ")).toBe("deleted");
  expect(statusFromCode("R ")).toBe("renamed");
  expect(statusFromCode("  ")).toBeNull();
});

it("builds a small added-file unified diff", () => {
  expect(buildAddedFileDiff("reports/new.csv", "name,status\nhtml,ok\n"))
    .toContain(`+++ b/reports/new.csv
@@ -0,0 +1,2 @@
+name,status
+html,ok`);
});

it("builds a modified-file diff with context and interleaved edits", () => {
  const diff = buildFullFileDiff(
    "src/example.ts",
    "const a = 1;\nconst b = 2;\nexport { a };\n",
    "const a = 1;\nconst b = 3;\nexport { a, b };\n",
  );

  expect(diff).toContain(`@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
-export { a };
+export { a, b };`);
});

it("keeps unchanged lines in full-file diffs", () => {
  const before = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[6] = "line 7 changed";

  expect(buildFullFileDiff("notes.txt", before.join("\n"), after.join("\n")))
    .toContain(` line 11
 line 12`);
});
