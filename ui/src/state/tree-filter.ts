export interface ExplorerFilterSummary {
  active: boolean;
  reviewPathCount: number;
}

export function explorerFilterText({
  active,
  reviewPathCount,
}: ExplorerFilterSummary): string {
  const mode = active ? "changed" : "live";
  return reviewPathCount ? `${mode} ${reviewPathCount}` : mode;
}

export function explorerFilterLabel({
  active,
  reviewPathCount,
}: ExplorerFilterSummary): string {
  const count =
    reviewPathCount === 1
      ? "1 review path"
      : `${reviewPathCount} review paths`;
  return active
    ? `Showing changed and review paths only, ${count}`
    : `Showing the live tree, ${count} available`;
}
