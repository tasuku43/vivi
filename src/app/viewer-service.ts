import type { ChangeReviewSummary, TextDiff } from "../domain/change-review.js";
import type {
  FilePayload,
  FsEvent,
  TreeSnapshot,
  ViewerConfig,
} from "../domain/fs-node.js";
import type { ViewerServiceOptions } from "./contracts.js";

export class ViewerService {
  private readonly fileSystem: ViewerServiceOptions["fileSystem"];
  private readonly watcher?: ViewerServiceOptions["watcher"];
  private readonly changeReview?: ViewerServiceOptions["changeReview"];
  private subscribers = new Set<(event: FsEvent) => void>();

  constructor(options: ViewerServiceOptions) {
    this.fileSystem = options.fileSystem;
    this.watcher = options.watcher;
    this.changeReview = options.changeReview;
  }

  readTree(): Promise<TreeSnapshot> {
    return this.fileSystem.readTree();
  }

  readFile(relativePath: string): Promise<FilePayload> {
    return this.fileSystem.readFile(relativePath);
  }

  readHtmlPreview(relativePath: string): Promise<string> {
    return this.fileSystem.readHtmlPreview(relativePath);
  }

  getConfig(): ViewerConfig {
    return (
      this.fileSystem.getConfig?.() ?? {
        root: ".",
        allowHtmlScripts: false,
        maxFileSizeBytes: 1024 * 1024,
      }
    );
  }

  readChanges(): Promise<ChangeReviewSummary> {
    return (
      this.changeReview?.readChanges() ??
      Promise.resolve({
        available: false,
        reason: "Git change review is unavailable for this workspace.",
        changes: [],
      })
    );
  }

  readDiff(relativePath: string): Promise<TextDiff> {
    return (
      this.changeReview?.readDiff(relativePath) ??
      Promise.resolve({
        path: relativePath,
        status: "unavailable",
        baseLabel: "HEAD",
        compareLabel: "working tree",
        content: "",
        reason: "Git change review is unavailable for this workspace.",
      })
    );
  }

  subscribe(listener: (event: FsEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async start(): Promise<void> {
    await this.watcher?.start((event) => {
      for (const subscriber of this.subscribers) subscriber(event);
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.stop();
    this.subscribers.clear();
  }
}
