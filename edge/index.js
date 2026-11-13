import { createEdgeHandler } from "./handler.mjs";
import config from "./config.generated.js";

export default { fetch: createEdgeHandler(config) };
