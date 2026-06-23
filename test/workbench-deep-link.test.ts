import { describe, expect, it } from "vitest";
import { parseWorkbenchDeepLink } from "../ui/src/state/workbench-deep-link.js";

describe("parseWorkbenchDeepLink", () => {
  it("opens a path from the query string", () => {
    expect(parseWorkbenchDeepLink("?path=net/netfilter/xt_DSCP.c")).toEqual({
      path: "net/netfilter/xt_DSCP.c",
      diff: false,
    });
  });

  it("can request HEAD diff mode for the opened path", () => {
    expect(
      parseWorkbenchDeepLink(
        "?path=net%2Fnetfilter%2Fxt_DSCP.c&diff=1",
      ),
    ).toEqual({
      path: "net/netfilter/xt_DSCP.c",
      diff: true,
    });
    expect(parseWorkbenchDeepLink("file=README.md&diff=head")).toEqual({
      path: "README.md",
      diff: true,
    });
  });

  it("ignores empty deep links", () => {
    expect(parseWorkbenchDeepLink("")).toBeNull();
    expect(parseWorkbenchDeepLink("?path=+")).toBeNull();
  });
});
