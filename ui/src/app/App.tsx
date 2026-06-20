import { WorkbenchContainer } from "../features/workbench/index.js";
import { GraphqlViviClient } from "../infrastructure/vivi-api/graphqlViviClient.js";

const client = new GraphqlViviClient();

export function App() {
  return <WorkbenchContainer client={client} />;
}
