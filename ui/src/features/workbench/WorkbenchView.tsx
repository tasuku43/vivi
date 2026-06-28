import type { ReactNode } from "react";
import sharedUiStyles from "../../shared/styles/SharedUi.module.css";

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
    <div className={`${sharedUiStyles.sharedUiStyles} workbench-shell`}>
      <aside
        className={`${sharedUiStyles.sidebar} sidebar`}
        aria-label="File explorer"
      >
        {sidebar}
      </aside>
      <main className="viewer-shell">{viewer}</main>
      <aside
        className={`${sharedUiStyles.inspector} inspector`}
        aria-label="Review inspector"
      >
        {inspector}
      </aside>
    </div>
  );
}
