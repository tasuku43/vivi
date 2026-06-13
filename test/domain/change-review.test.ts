import { expect, it } from "vitest";
import {
  buildAddedFileDiff,
  parseGitPorcelainStatus,
  statusFromCode,
} from "../../src/domain/change-review.js";

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
