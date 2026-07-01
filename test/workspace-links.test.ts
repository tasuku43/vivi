import { describe, expect, it } from "vitest";
import { resolveWorkspaceLink } from "../ui/src/state/workspace-links.js";

describe("resolveWorkspaceLink", () => {
  it("resolves links relative to the current file", () => {
    expect(resolveWorkspaceLink("README.md", "docs/product/00-product-thesis.md")).toBe(
      "docs/product/00-product-thesis.md",
    );
    expect(resolveWorkspaceLink("docs/guide/index.md", "../api.md")).toBe(
      "docs/api.md",
    );
  });

  it("resolves root-relative workspace links", () => {
    expect(resolveWorkspaceLink("docs/guide/index.md", "/README.md")).toBe(
      "README.md",
    );
  });

  it("strips query and hash fragments from local file links", () => {
    expect(
      resolveWorkspaceLink("docs/guide.md", "./api.md?plain=1#section"),
    ).toBe("docs/api.md");
  });

  it("rejects links that are not workspace file paths", () => {
    expect(resolveWorkspaceLink("README.md", "#usage")).toBeNull();
    expect(resolveWorkspaceLink("README.md", "https://example.com")).toBeNull();
    expect(
      resolveWorkspaceLink("README.md", "mailto:team@example.com"),
    ).toBeNull();
    expect(resolveWorkspaceLink("README.md", "../secret.md")).toBeNull();
  });
});
