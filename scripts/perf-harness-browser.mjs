export function isTransientBrowserWorkspaceError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("timed out waiting for Vivi workspace chrome") ||
    message.includes("Execution context was destroyed") ||
    message.includes("Target page, context or browser has been closed") ||
    message.includes("Navigation failed because page was closed")
  );
}
