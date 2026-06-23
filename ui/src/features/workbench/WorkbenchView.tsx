import type { ReactNode } from "react";

export interface WorkbenchViewProps {
  sidebar: ReactNode;
  viewer: ReactNode;
  inspector: ReactNode;
}

/** Presentational shell used by stories and focused layout tests. */
export function WorkbenchView({
  sidebar,
  viewer,
  inspector,
}: WorkbenchViewProps) {
  return (
    <div className="workbench-shell">
      <aside className="sidebar" aria-label="File explorer">
        {sidebar}
      </aside>
      <main className="viewer-shell">{viewer}</main>
      <aside className="inspector" aria-label="Review inspector">
        {inspector}
      </aside>
    </div>
  );
}
