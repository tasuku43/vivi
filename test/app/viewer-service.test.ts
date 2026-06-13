import { expect, it } from "vitest";
import { ViewerService } from "../../src/app/viewer-service.js";
import type {
  ChangeReviewPort,
  FileSystemPort,
} from "../../src/app/contracts.js";

it("delegates tree reads to the filesystem port", async () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
    getConfig() {
      return { root: ".", allowHtmlScripts: false, maxFileSizeBytes: 123 };
    },
  };
  const service = new ViewerService({ fileSystem: fsPort });
  await expect(service.readTree()).resolves.toEqual({
    root: ".",
    version: 1,
    nodes: [],
  });
  expect(service.getConfig()).toEqual({
    root: ".",
    allowHtmlScripts: false,
    maxFileSizeBytes: 123,
  });
});

it("delegates Git review reads when the optional port is present", async () => {
  const fsPort: FileSystemPort = {
    async readTree() {
      return { root: ".", version: 1, nodes: [] };
    },
    async readFile() {
      throw new Error("not used");
    },
    async readHtmlPreview() {
      throw new Error("not used");
    },
  };
  const changeReview: ChangeReviewPort = {
    async readChanges() {
      return {
        available: true,
        changes: [{ path: "README.md", status: "modified" }],
      };
    },
    async readDiff(relativePath) {
      return {
        path: relativePath,
        status: "available",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "diff",
      };
    },
  };

  const service = new ViewerService({ fileSystem: fsPort, changeReview });

  await expect(service.readChanges()).resolves.toEqual({
    available: true,
    changes: [{ path: "README.md", status: "modified" }],
  });
  await expect(service.readDiff("README.md")).resolves.toMatchObject({
    path: "README.md",
    status: "available",
  });
});
