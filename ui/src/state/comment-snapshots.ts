import type { ViviComment } from "../domain/comments.js";

/** Guards authoritative reads against mutations that happened while in flight. */
export class CommentSnapshots {
  revision = 0;
  private deleted = new Set<string>();

  invalidate() {
    this.revision += 1;
  }

  remove(id: string) {
    this.deleted.add(id);
    this.invalidate();
  }

  retained(items: ViviComment[]) {
    return items.filter((item) => !this.deleted.has(item.id));
  }

  apply(
    current: ViviComment[],
    incoming: ViviComment[],
    path: string | null,
    revision: number,
  ) {
    if (revision !== this.revision) return this.retained(current);
    return this.retained([
      ...(path ? current.filter((item) => item.path !== path) : []),
      ...incoming,
    ]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
