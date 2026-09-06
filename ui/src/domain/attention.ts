export interface DocumentAttentionEvent {
  path: string;
  at: number;
  reason: "Read by agent" | "Updated" | "Opened" | "Presented by agent";
}
export interface DocumentAttentionSnapshot {
  events: DocumentAttentionEvent[];
  eligiblePaths: string[];
  headings: Record<string, string>;
}
