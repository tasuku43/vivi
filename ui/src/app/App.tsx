import { WorkbenchContainer } from "../features/workbench/index.js";
import { RestViviClient } from "../infrastructure/vivi-api/restViviClient.js";

const client = new RestViviClient();

export function App() {
  return <WorkbenchContainer client={client} />;
}
