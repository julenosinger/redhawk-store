import { normalize } from "node:path";
const normalizePaths = (paths) => {
  return paths.map((p) => {
    let normalizedPath = normalize(p).replace(/\\/g, "/");
    if (normalizedPath.startsWith("./")) {
      normalizedPath = normalizedPath.substring(2);
    }
    return "/" + normalizedPath;
  });
};
const getEntryContent = async (options) => {
  const globStr = normalizePaths(options.entry).map((e) => `'${e}'`).join(",");
  const appStr = `const modules = import.meta.glob([${globStr}], { import: 'default', eager: true })
      let added = false
      for (const [, app] of Object.entries(modules)) {
        if (app) {
          worker.route('/', app)
          worker.notFound(app.notFoundHandler)
          added = true
        }
      }
      if (!added) {
        throw new Error("Can't import modules from [${globStr}]")
      }
      `;
  return `import { Hono } from 'hono'

const worker = new Hono()

${appStr}

export default worker`;
};
export {
  getEntryContent
};
