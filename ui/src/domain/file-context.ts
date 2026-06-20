import type { TextDiff } from "./change-review.js";
import type { ViviComment } from "./comments.js";
import type { FilePayload } from "./fs-node.js";

/** Everything the workbench may need to present one file. */
export interface FileContext {
  file: FilePayload;
  comments: ViviComment[];
  diff?: TextDiff;
}
