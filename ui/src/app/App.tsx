import { WorkbenchContainer } from "../features/workbench/index.js";
import { CommentInputSessionProvider } from "../features/comments/CommentInputSessionProvider.js";
import { LightGraphqlViviClient } from "../infrastructure/vivi-api/lightGraphqlViviClient.js";

const client = new LightGraphqlViviClient();

export function App() {
  return (
    <CommentInputSessionProvider>
      <WorkbenchContainer client={client} />
    </CommentInputSessionProvider>
  );
}
