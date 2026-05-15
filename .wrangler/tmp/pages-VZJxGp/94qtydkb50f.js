// <define:__ROUTES__>
var define_ROUTES_default = { version: 1, include: ["/*"], exclude: ["/_headers", "/images/*", "/og-image.jpg", "/static/*"] };

// node_modules/wrangler/templates/pages-dev-pipeline.ts
import worker from "/home/user/admin-panel/.wrangler/tmp/pages-VZJxGp/bundledWorker-0.5875258660714584.mjs";
import { isRoutingRuleMatch } from "/home/user/admin-panel/node_modules/wrangler/templates/pages-dev-util.ts";
export * from "/home/user/admin-panel/.wrangler/tmp/pages-VZJxGp/bundledWorker-0.5875258660714584.mjs";
var routes = define_ROUTES_default;
var pages_dev_pipeline_default = {
  fetch(request, env, context) {
    const { pathname } = new URL(request.url);
    for (const exclude of routes.exclude) {
      if (isRoutingRuleMatch(pathname, exclude)) {
        return env.ASSETS.fetch(request);
      }
    }
    for (const include of routes.include) {
      if (isRoutingRuleMatch(pathname, include)) {
        const workerAsHandler = worker;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  pages_dev_pipeline_default as default
};
//# sourceMappingURL=94qtydkb50f.js.map
