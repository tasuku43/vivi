import { expect, it } from "vitest";
import { ViewerService } from "../../src/app/viewer-service.js";
import type { FileSystemPort } from "../../src/app/contracts.js";

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
