import { describe, expect, it } from "vitest";
import { activeOutlineHeadingId } from "../ui/src/state/outline-position.js";

describe("activeOutlineHeadingId", () => {
  it("uses the first heading before the reader reaches later sections", () => {
    expect(
      activeOutlineHeadingId([
        { id: "intro", top: 128 },
        { id: "setup", top: 420 },
      ]),
    ).toBe("intro");
  });

  it("uses the last heading that has crossed the reading threshold", () => {
    expect(
      activeOutlineHeadingId([
        { id: "intro", top: -320 },
        { id: "setup", top: 44 },
        { id: "details", top: 260 },
      ]),
    ).toBe("setup");
  });

  it("handles unsorted DOM positions", () => {
    expect(
      activeOutlineHeadingId([
        { id: "details", top: 240 },
        { id: "intro", top: -80 },
        { id: "setup", top: 12 },
      ]),
    ).toBe("setup");
  });

  it("returns null without headings", () => {
    expect(activeOutlineHeadingId([])).toBeNull();
  });
});
