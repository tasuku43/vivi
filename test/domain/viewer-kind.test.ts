import { expect, it } from "vitest";
import { classifyViewer } from "../../server/typescript/domain/viewer-kind.js";

it("classifies common viewer kinds", () => {
  expect(classifyViewer("README.md")).toBe("markdown");
  expect(classifyViewer("index.html")).toBe("html");
  expect(classifyViewer("src/app.ts")).toBe("code");
  expect(classifyViewer("data.json")).toBe("json");
  expect(classifyViewer("notes.txt")).toBe("text");
  expect(classifyViewer("diagram.mmd")).toBe("mermaid");
  expect(classifyViewer("image.png")).toBe("image");
  expect(classifyViewer("archive.zip")).toBe("binary");
  expect(classifyViewer("Dockerfile")).toBe("code");
  expect(classifyViewer("infra/Dockerfile")).toBe("code");
  expect(classifyViewer("artifact.generated")).toBe("unsupported");
});
