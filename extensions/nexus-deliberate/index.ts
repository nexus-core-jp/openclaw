import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { createDeliberateTool } from "./src/deliberate-tool.js";
import { createDeliberateHttpHandler } from "./src/http-route.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createDeliberateTool(api), { optional: true });
  api.registerHttpRoute({
    path: "/v1/deliberate",
    handler: createDeliberateHttpHandler(api),
  });
}
