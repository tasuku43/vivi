import { WorkbenchContainer } from "../features/workbench/index.js";
import { LightGraphqlViviClient } from "../infrastructure/vivi-api/lightGraphqlViviClient.js";

const client = new LightGraphqlViviClient();

export function App() {
  return <WorkbenchContainer client={client} />;
}
