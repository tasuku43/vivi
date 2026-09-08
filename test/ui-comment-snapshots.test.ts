import { expect, it } from "vitest";
import type { ViviComment } from "../ui/src/domain/comments.js";
import { CommentSnapshots } from "../ui/src/state/comment-snapshots.js";
const comment = (id: string, path = "a.md") =>
  ({ id, path, createdAt: "2026-09-08" }) as ViviComment;

it("treats global refreshes as authoritative, including an empty last thread", () => {
  const snapshots = new CommentSnapshots();
  expect(snapshots.apply([comment("deleted")], [], null, 0)).toEqual([]);
});
it("replaces only the requested document for scoped refreshes", () => {
  const snapshots = new CommentSnapshots();
  expect(
    snapshots.apply(
      [comment("deleted"), comment("other", "b.md")],
      [],
      "a.md",
      0,
    ),
  ).toEqual([comment("other", "b.md")]);
});
it("prevents pre-delete and delayed replica responses from resurrecting feedback", () => {
  const snapshots = new CommentSnapshots();
  const revision = snapshots.revision;
  snapshots.remove("deleted");
  expect(
    snapshots.apply(
      [comment("remaining")],
      [comment("deleted")],
      null,
      revision,
    ),
  ).toEqual([comment("remaining")]);
  expect(
    snapshots.apply([], [comment("deleted")], null, snapshots.revision),
  ).toEqual([]);
});
it("invalidates reads started before another client's journal refresh or publication", () => {
  const snapshots = new CommentSnapshots();
  snapshots.invalidate();
  expect(snapshots.apply([comment("new")], [], null, 0)).toEqual([
    comment("new"),
  ]);
});
