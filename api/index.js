
// Node.js shims for Cloudflare Workers globals
if (typeof globalThis.caches === 'undefined') {
  globalThis.caches = { default: { match: () => undefined, put: () => undefined } }
}


// api/_entry.tsx
import { handle } from "@hono/node-server/vercel";

// node_modules/hono/dist/compose.js
var compose = (middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler2;
      if (middleware[i]) {
        handler2 = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler2 = i === middleware.length && next || void 0;
      }
      if (handler2) {
        try {
          res = await handler2(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
  };
};

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
var parseBody = async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
};
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
var handleParsingAllValues = (form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
};
var handleParsingNestedValues = (form, key, value) => {
  if (/(?:^|\.)__proto__\./.test(key)) {
    return;
  }
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
};

// node_modules/hono/dist/utils/url.js
var splitPath = (path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
};
var splitRoutingPath = (routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
};
var extractGroupsFromPath = (path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
    return mark;
  });
  return { groups, path };
};
var replaceGroupMarks = (paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
};
var patternCache = {};
var getPattern = (label, next) => {
  if (label === "*") {
    return "*";
  }
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
};
var tryDecode = (str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
};
var tryDecodeURI = (str) => tryDecode(str, decodeURI);
var getPath = (request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const hashIndex = url.indexOf("#", i);
      const end = queryIndex === -1 ? hashIndex === -1 ? void 0 : hashIndex : hashIndex === -1 ? queryIndex : Math.min(queryIndex, hashIndex);
      const path = url.slice(start, end);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63 || charCode === 35) {
      break;
    }
  }
  return url.slice(start, i);
};
var getPathNoStrict = (request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
};
var mergePath = (base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
};
var checkOptionalParameter = (path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
};
var _decodeURI = (value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
};
var _getQueryParam = (url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
};
var getQueryParam = _getQueryParam;
var getQueryParams = (url, key) => {
  return _getQueryParam(url, key, true);
};
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = (str) => tryDecode(str, decodeURIComponent_);
var HonoRequest = class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return parseBody(this, options);
  }
  #cachedBody = (key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = (value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
};
var resolveCallback = async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
};

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = (contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
};
var createResponseInstance = (body, init) => new Response(body, init);
var Context = class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= createResponseInstance(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
  set res(_res) {
    if (this.#res && _res) {
      _res = createResponseInstance(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name, value, options) => {
    if (this.finalized) {
      this.#res = createResponseInstance(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return createResponseInstance(data, { status, headers: responseHeaders });
  }
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = (html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers));
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => createResponseInstance();
    return this.#notFoundHandler(this);
  };
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = (c) => {
  return c.text("404 Not Found", 404);
};
var errorHandler = (err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
};
var Hono = class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler2) => {
          this.#addRoute(method, this.#path, handler2);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler2) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler2);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler2) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler2);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler2;
      if (app2.errorHandler === errorHandler) {
        handler2 = r.handler;
      } else {
        handler2 = async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res;
        handler2[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler2);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler2) => {
    this.errorHandler = handler2;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler2) => {
    this.#notFoundHandler = handler2;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = (request) => request;
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler2 = async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    };
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler2);
    return this;
  }
  #addRoute(method, path, handler2) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler: handler2 };
    this.router.add(method, path, [handler2, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
};

// node_modules/hono/dist/router/reg-exp-router/matcher.js
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = ((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  });
  this.match = match2;
  return match2(method, path);
}

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
var Node = class _Node {
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new _Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new _Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
var RegExpRouter = class {
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler2) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler2, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler2, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler2, paramCount - len + i + 1]);
        }
      });
    }
  }
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler2) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler2]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var hasChildren = (children) => {
  for (const _ in children) {
    return true;
  }
  return false;
};
var Node2 = class _Node2 {
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler2, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler2) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler: handler2, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler2) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new _Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler: handler2,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #pushHandlerSets(handlerSets, node, method, nodeParams, params) {
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    const len = parts.length;
    let partOffsets = null;
    for (let i = 0; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              this.#pushHandlerSets(handlerSets, nextNode.#children["*"], method, node.#params);
            }
            this.#pushHandlerSets(handlerSets, nextNode, method, node.#params);
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              this.#pushHandlerSets(handlerSets, astNode, method, node.#params);
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          if (matcher instanceof RegExp) {
            if (partOffsets === null) {
              partOffsets = new Array(len);
              let offset = path[0] === "/" ? 1 : 0;
              for (let p = 0; p < len; p++) {
                partOffsets[p] = offset;
                offset += parts[p].length + 1;
              }
            }
            const restPathString = path.substring(partOffsets[i]);
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              this.#pushHandlerSets(handlerSets, child, method, node.#params, params);
              if (hasChildren(child.#children)) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              this.#pushHandlerSets(handlerSets, child, method, params, node.#params);
              if (child.#children["*"]) {
                this.#pushHandlerSets(
                  handlerSets,
                  child.#children["*"],
                  method,
                  params,
                  node.#params
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      const shifted = curNodesQueue.shift();
      curNodes = shifted ? tempNodes.concat(shifted) : tempNodes;
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler: handler2, params }) => [handler2, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler2) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler2);
      }
      return;
    }
    this.#node.insert(method, path, handler2);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/hono/dist/middleware/cors/index.js
var cors = (options) => {
  const defaults = {
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    allowHeaders: [],
    exposeHeaders: []
  };
  const opts = {
    ...defaults,
    ...options
  };
  const findAllowOrigin = ((optsOrigin) => {
    if (typeof optsOrigin === "string") {
      if (optsOrigin === "*") {
        if (opts.credentials) {
          return (origin) => origin || null;
        }
        return () => optsOrigin;
      } else {
        return (origin) => optsOrigin === origin ? origin : null;
      }
    } else if (typeof optsOrigin === "function") {
      return optsOrigin;
    } else {
      return (origin) => optsOrigin.includes(origin) ? origin : null;
    }
  })(opts.origin);
  const findAllowMethods = ((optsAllowMethods) => {
    if (typeof optsAllowMethods === "function") {
      return optsAllowMethods;
    } else if (Array.isArray(optsAllowMethods)) {
      return () => optsAllowMethods;
    } else {
      return () => [];
    }
  })(opts.allowMethods);
  return async function cors2(c, next) {
    function set(key, value) {
      c.res.headers.set(key, value);
    }
    const allowOrigin = await findAllowOrigin(c.req.header("origin") || "", c);
    if (allowOrigin) {
      set("Access-Control-Allow-Origin", allowOrigin);
    }
    if (opts.credentials) {
      set("Access-Control-Allow-Credentials", "true");
    }
    if (opts.exposeHeaders?.length) {
      set("Access-Control-Expose-Headers", opts.exposeHeaders.join(","));
    }
    if (c.req.method === "OPTIONS") {
      if (opts.origin !== "*" || opts.credentials) {
        set("Vary", "Origin");
      }
      if (opts.maxAge != null) {
        set("Access-Control-Max-Age", opts.maxAge.toString());
      }
      const allowMethods = await findAllowMethods(c.req.header("origin") || "", c);
      if (allowMethods.length) {
        set("Access-Control-Allow-Methods", allowMethods.join(","));
      }
      let headers = opts.allowHeaders;
      if (!headers?.length) {
        const requestHeaders = c.req.header("Access-Control-Request-Headers");
        if (requestHeaders) {
          headers = requestHeaders.split(/\s*,\s*/);
        }
      }
      if (headers?.length) {
        set("Access-Control-Allow-Headers", headers.join(","));
        c.res.headers.append("Vary", "Access-Control-Request-Headers");
      }
      c.res.headers.delete("Content-Length");
      c.res.headers.delete("Content-Type");
      return new Response(null, {
        headers: c.res.headers,
        status: 204,
        statusText: "No Content"
      });
    }
    await next();
    if (opts.origin !== "*" || opts.credentials) {
      c.header("Vary", "Origin", { append: true });
    }
  };
};

// src/index.tsx
var app = new Hono2();
app.use("*", cors());
app.use("*", async (c, next) => {
  await next();
  const url = new URL(c.req.url);
  const path = url.pathname;
  c.res.headers.set("X-Frame-Options", "DENY");
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("X-XSS-Protection", "0");
  c.res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()");
  c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  c.res.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
    "img-src 'self' data: blob: https: ipfs: https://ipfs.io https://cloudflare-ipfs.com https://gateway.pinata.cloud https://www.genspark.ai",
    "connect-src 'self' https://rpc.testnet.arc.network https://rpc.blockdaemon.testnet.arc.network https://api.circle.com https://testnet.arcscan.app https://faucet.circle.com https://ipfs.io wss:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
  c.res.headers.set("Content-Security-Policy", csp);
  if (path.startsWith("/static/") || path.startsWith("/images/")) {
    const maxAge = path.startsWith("/images/") ? 604800 : 31536e3;
    const immutable = path.startsWith("/static/") ? ", immutable" : "";
    c.res.headers.set("Cache-Control", `public, max-age=${maxAge}${immutable}`);
  } else if (path.startsWith("/api/")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
});
var _memProducts = [];
function nowISO() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function kvGetAll(kv) {
  try {
    const raw2 = await kv.get("products_v1");
    return raw2 ? JSON.parse(raw2) : [];
  } catch {
    return [];
  }
}
async function kvSaveAll(kv, products) {
  await kv.put("products_v1", JSON.stringify(products));
}
async function vercelKvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${key}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = await res.json();
    if (json.result == null) return [];
    return JSON.parse(json.result);
  } catch {
    return null;
  }
}
async function vercelKvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(`${url}/set/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch {
  }
}
var CF_KV_NS = "e7c8a4b7a03c4cd9b0a577817b26f868";
var CF_KV_URL = `https://api.cloudflare.com/client/v4/accounts`;
async function cfKvGet(key) {
  const token = process.env.CF_API_TOKEN;
  const account = process.env.CF_ACCOUNT_ID;
  if (!token || !account) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8e3);
    const res = await fetch(`${CF_KV_URL}/${account}/storage/kv/namespaces/${CF_KV_NS}/values/${key}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text === "null") return [];
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function cfKvSet(key, value) {
  const token = process.env.CF_API_TOKEN;
  const account = process.env.CF_ACCOUNT_ID;
  if (!token || !account) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8e3);
    const form = new FormData();
    form.append("value", JSON.stringify(value));
    form.append("metadata", "{}");
    await fetch(`${CF_KV_URL}/${account}/storage/kv/namespaces/${CF_KV_NS}/values/${key}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: ctrl.signal
    });
    clearTimeout(timer);
  } catch {
  }
}
function hasVercelKV() {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}
function hasCfKV() {
  return !!(process.env.CF_API_TOKEN && process.env.CF_ACCOUNT_ID);
}
function makeSlim(products) {
  return products.map(({ image: _img, ...rest }) => rest);
}
async function storageGet(cfBinding) {
  if (hasVercelKV()) {
    const d = await vercelKvGet("products_v1");
    if (d !== null) return { data: d, source: "vercel-kv" };
  }
  if (hasCfKV()) {
    const d = await cfKvGet("products_v1");
    if (d !== null) return { data: d, source: "cf-kv-rest" };
  }
  if (cfBinding) {
    return { data: await kvGetAll(cfBinding), source: "KV" };
  }
  return { data: _memProducts, source: "memory" };
}
async function storageGetSlim(cfBinding) {
  if (hasVercelKV()) {
    const d = await vercelKvGet("products_slim_v1");
    if (d !== null && d.length > 0) return { data: d, source: "vercel-kv-slim" };
    const full = await vercelKvGet("products_v1");
    if (full !== null) return { data: makeSlim(full), source: "vercel-kv" };
  }
  if (hasCfKV()) {
    const slim = await cfKvGet("products_slim_v1");
    if (slim !== null && slim.length > 0) return { data: slim, source: "cf-kv-rest-slim" };
    const full = await cfKvGet("products_v1");
    if (full !== null) {
      const slimmed = makeSlim(full);
      cfKvSet("products_slim_v1", slimmed).catch(() => {
      });
      return { data: slimmed, source: "cf-kv-rest" };
    }
  }
  if (cfBinding) {
    const all = await kvGetAll(cfBinding);
    return { data: makeSlim(all), source: "KV" };
  }
  return { data: makeSlim(_memProducts), source: "memory" };
}
async function storageSet(products, cfBinding) {
  if (hasVercelKV()) {
    await vercelKvSet("products_v1", products);
    await vercelKvSet("products_slim_v1", makeSlim(products));
    return;
  }
  if (hasCfKV()) {
    await Promise.all([
      cfKvSet("products_v1", products),
      cfKvSet("products_slim_v1", makeSlim(products))
    ]);
    return;
  }
  if (cfBinding) {
    await kvSaveAll(cfBinding, products);
    return;
  }
  _memProducts = products;
}
var store = {
  // List products with optional filters
  async list(env, opts) {
    if (env.DB) {
      try {
        let sql = `SELECT * FROM products WHERE status = 'active'`;
        const params = [];
        if (opts.category) {
          sql += ` AND category = ?`;
          params.push(opts.category);
        }
        if (opts.seller) {
          sql += ` AND seller_id = ?`;
          params.push(opts.seller);
        }
        if (opts.q) {
          sql += ` AND (title LIKE ? OR description LIKE ?)`;
          params.push(`%${opts.q}%`, `%${opts.q}%`);
        }
        sql += ` ORDER BY created_at DESC`;
        const stmt = env.DB.prepare(sql);
        const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
        return { products: results, source: "D1" };
      } catch (e) {
        console.error("D1 list error:", e.message);
      }
    }
    const { data: all, source } = await storageGetSlim(env.PRODUCTS_KV);
    let filtered = all.filter((p) => p.status === "active");
    if (opts.category) filtered = filtered.filter((p) => p.category === opts.category);
    if (opts.seller) filtered = filtered.filter((p) => p.seller_id === opts.seller);
    if (opts.q) {
      const qLow = opts.q.toLowerCase();
      filtered = filtered.filter((p) => p.title.toLowerCase().includes(qLow) || p.description.toLowerCase().includes(qLow));
    }
    filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { products: filtered, source };
  },
  // Get single product by id
  async get(env, id) {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).bind(id).first();
        return row || null;
      } catch (e) {
        console.error("D1 get error:", e.message);
      }
    }
    const { data: all2 } = await storageGet(env.PRODUCTS_KV);
    return all2.find((p) => p.id === id && p.status === "active") || null;
  },
  // Get product by id (any status) — for seller operations
  async getAny(env, id) {
    if (env.DB) {
      try {
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
        return row || null;
      } catch (e) {
        console.error("D1 getAny error:", e.message);
      }
    }
    const { data: allG } = await storageGet(env.PRODUCTS_KV);
    return allG.find((p) => p.id === id) || null;
  },
  // List products for a seller (all statuses except deleted)
  async listBySeller(env, address) {
    if (env.DB) {
      try {
        const { results } = await env.DB.prepare(
          `SELECT * FROM products WHERE seller_id = ? AND status != 'deleted' ORDER BY created_at DESC`
        ).bind(address).all();
        return results;
      } catch (e) {
        console.error("D1 listBySeller error:", e.message);
      }
    }
    const { data: allS } = await storageGet(env.PRODUCTS_KV);
    return allS.filter((p) => p.seller_id === address && p.status !== "deleted").sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  // Create a product
  async create(env, data) {
    const id = nanoid();
    const now = nowISO();
    const product = { ...data, id, status: "active", created_at: now, updated_at: now };
    if (env.DB) {
      try {
        await env.DB.prepare(`
          INSERT INTO products (id,title,description,price,token,image,category,stock,seller_id)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(id, data.title, data.description, data.price, data.token, data.image, data.category, data.stock, data.seller_id).run();
        const row = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
        return row || product;
      } catch (e) {
        console.error("D1 create error:", e.message);
      }
    }
    const { data: allC } = await storageGet(env.PRODUCTS_KV);
    allC.unshift(product);
    await storageSet(allC, env.PRODUCTS_KV);
    return product;
  },
  // Update product status
  async setStatus(env, id, status) {
    if (env.DB) {
      try {
        await env.DB.prepare(`UPDATE products SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
        return true;
      } catch (e) {
        console.error("D1 setStatus error:", e.message);
      }
    }
    const { data: allSt } = await storageGet(env.PRODUCTS_KV);
    const idx = allSt.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    allSt[idx].status = status;
    allSt[idx].updated_at = nowISO();
    await storageSet(allSt, env.PRODUCTS_KV);
    return true;
  }
};
var _dbReady = false;
async function initDB(db) {
  if (!db || _dbReady) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      price REAL NOT NULL, token TEXT NOT NULL DEFAULT 'USDC', image TEXT,
      category TEXT NOT NULL DEFAULT 'Other', stock INTEGER NOT NULL DEFAULT 1,
      seller_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC)`).run();
    _dbReady = true;
  } catch (e) {
    console.error("initDB error (non-fatal):", e.message);
  }
}
function nanoid() {
  return "prod_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
app.get("/favicon.ico", (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="#dc2626"/></svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
});
var ARC = {
  chainId: 5042002,
  chainIdHex: "0x4CE2D2",
  rpc: "https://rpc.testnet.arc.network",
  rpcAlt: "https://rpc.blockdaemon.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  faucet: "https://faucet.circle.com",
  networkName: "Arc Testnet",
  currency: "USDC",
  contracts: {
    USDC: "0x3600000000000000000000000000000000000000",
    EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    Multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    // ShuklyEscrow: verified on ArcScan (testnet.arcscan.app)
    // Contract: ShuklyEscrow | solc 0.8.34 | optimizer: true, runs: 200 | MIT
    // Verified: https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511
    ShuklyEscrow: "0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511"
  }
};
app.get("/api/arc-config", (c) => {
  return c.json({ arc: ARC });
});
var CIRCLE_BASE_URL = "https://api.circle.com/v1";
async function circleRequest(env, method, path, body) {
  const apiKey = env.CIRCLE_API_KEY;
  if (!apiKey) return { ok: false, status: 500, data: { error: "CIRCLE_API_KEY not configured" } };
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
  const opts = { method, headers };
  if (body && method !== "GET") opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${CIRCLE_BASE_URL}${path}`, opts);
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 500, data: { error: e.message } };
  }
}
app.get("/api/arc-payment/info", (c) => {
  return c.json({
    network: "Arc Testnet",
    chainId: ARC.chainId,
    chainHex: ARC.chainIdHex,
    rpc: ARC.rpc,
    explorer: ARC.explorer,
    faucet: ARC.faucet,
    tokens: {
      USDC: { address: ARC.contracts.USDC, decimals: 6, symbol: "USDC", name: "USD Coin" },
      EURC: { address: ARC.contracts.EURC, decimals: 6, symbol: "EURC", name: "Euro Coin" }
    },
    escrow: {
      address: ARC.contracts.ShuklyEscrow,
      deployed: ARC.contracts.ShuklyEscrow !== "0x0000000000000000000000000000000000000000",
      explorer: `${ARC.explorer}/address/${ARC.contracts.ShuklyEscrow}`
    },
    integration: {
      name: "Arc Commerce",
      version: "1.0.0",
      description: "Circle USDC payment layer \u2014 non-destructive extension",
      source: "https://github.com/circlefin/arc-commerce",
      isTestnet: true
    }
  });
});
app.post("/api/arc-payment/validate", async (c) => {
  try {
    const body = await c.req.json();
    const { buyerAddress, sellerAddress, amount, token = "USDC", orderId } = body;
    const errors = [];
    const addrRe = /^0x[0-9a-fA-F]{40}$/;
    if (!addrRe.test(buyerAddress)) errors.push("Invalid buyer address");
    if (!addrRe.test(sellerAddress)) errors.push("Invalid seller address");
    if (buyerAddress && sellerAddress && buyerAddress.toLowerCase() === sellerAddress.toLowerCase())
      errors.push("Buyer and seller cannot be the same address");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0)
      errors.push("Amount must be a positive number");
    if (!["USDC", "EURC"].includes(token))
      errors.push("Token must be USDC or EURC");
    if (!orderId || typeof orderId !== "string" || orderId.trim() === "")
      errors.push("orderId is required");
    if (errors.length > 0) {
      return c.json({ valid: false, errors }, 400);
    }
    return c.json({
      valid: true,
      payment: {
        orderId: orderId.trim(),
        buyerAddress: buyerAddress.toLowerCase(),
        sellerAddress: sellerAddress.toLowerCase(),
        amount: Number(amount).toFixed(6),
        token,
        tokenAddress: token === "EURC" ? ARC.contracts.EURC : ARC.contracts.USDC,
        escrowAddress: ARC.contracts.ShuklyEscrow,
        network: "Arc Testnet",
        chainId: ARC.chainId
      }
    });
  } catch (e) {
    return c.json({ valid: false, errors: [e.message] }, 500);
  }
});
app.get("/api/circle/ping", async (c) => {
  const r = await circleRequest(c.env, "GET", "/ping");
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || "Circle API error", status: r.status }, r.status);
  return c.json({ ok: true, message: "Circle API reachable", data: r.data });
});
app.get("/api/circle/config", (c) => {
  const hasKey = !!c.env.CIRCLE_API_KEY;
  return c.json({
    configured: hasKey,
    blockchain: "ARC-TESTNET",
    usdc_token_id: "USDC-ARC-TESTNET",
    network: "Arc Testnet",
    chain_id: ARC.chainId,
    usdc_address: ARC.contracts.USDC,
    eurc_address: ARC.contracts.EURC,
    explorer: ARC.explorer,
    faucet: ARC.faucet,
    // Key is never returned — only presence confirmed
    key_status: hasKey ? "configured" : "missing"
  });
});
app.get("/api/circle/wallets", async (c) => {
  const r = await circleRequest(c.env, "GET", "/developer/wallets");
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || "Circle API error", status: r.status }, r.status);
  return c.json({ ok: true, wallets: r.data?.data || [], count: r.data?.data?.length || 0 });
});
app.get("/api/circle/wallet/:id/balance", async (c) => {
  const walletId = c.req.param("id");
  const r = await circleRequest(c.env, "GET", `/developer/wallets/${walletId}/balances`);
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || "Circle API error" }, r.status);
  return c.json({ ok: true, balances: r.data?.data?.tokenBalances || [], walletId });
});
app.post("/api/circle/transfer", async (c) => {
  try {
    const body = await c.req.json();
    const { sourceWalletId, destinationAddress, amount, idempotencyKey } = body;
    if (!sourceWalletId || !destinationAddress || !amount)
      return c.json({ ok: false, error: "Missing required fields: sourceWalletId, destinationAddress, amount" }, 400);
    const addrRe = /^0x[0-9a-fA-F]{40}$/;
    if (!addrRe.test(destinationAddress))
      return c.json({ ok: false, error: "Invalid destination address" }, 400);
    if (isNaN(Number(amount)) || Number(amount) <= 0)
      return c.json({ ok: false, error: "Amount must be a positive number" }, 400);
    const payload = {
      idempotencyKey: idempotencyKey || crypto.randomUUID(),
      source: { type: "wallet", id: sourceWalletId },
      destination: { type: "blockchain", address: destinationAddress, chain: "ARC" },
      amount: { amount: Number(amount).toFixed(6), currency: "USD" }
    };
    const r = await circleRequest(c.env, "POST", "/transfers", payload);
    if (!r.ok) return c.json({ ok: false, error: r.data?.message || "Transfer failed", details: r.data }, r.status);
    return c.json({ ok: true, transfer: r.data?.data, message: "Transfer initiated" });
  } catch (e) {
    return c.json({ ok: false, error: e.message }, 500);
  }
});
app.get("/api/circle/transfer/:id", async (c) => {
  const transferId = c.req.param("id");
  const r = await circleRequest(c.env, "GET", `/transfers/${transferId}`);
  if (!r.ok) return c.json({ ok: false, error: r.data?.message || "Circle API error" }, r.status);
  return c.json({ ok: true, transfer: r.data?.data });
});
app.get("/api/products", async (c) => {
  try {
    await initDB(c.env.DB);
    const { products, source } = await store.list(c.env, {
      category: c.req.query("category") || "",
      seller: c.req.query("seller") || "",
      q: c.req.query("q") || ""
    });
    const slim = products.map(({ image: _img, ...rest }) => rest);
    return c.json({ products: slim, total: slim.length, source });
  } catch (e) {
    return c.json({ products: [], total: 0, source: "error", error: e.message });
  }
});
app.get("/api/products/images", async (c) => {
  try {
    const idsParam = c.req.query("ids") || "";
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    if (ids.length === 0) return c.json({ images: {} });
    const { data: products } = await storageGet(c.env.PRODUCTS_KV);
    const images = {};
    for (const id of ids) {
      const p = products.find((x) => x.id === id);
      if (p && p.image) images[id] = p.image;
    }
    return c.json({ images });
  } catch (e) {
    return c.json({ images: {}, error: e.message });
  }
});
app.get("/api/products/:id", async (c) => {
  try {
    await initDB(c.env.DB);
    const product = await store.get(c.env, c.req.param("id"));
    if (!product) return c.json({ error: "Product not found", product: null }, 404);
    return c.json({ product });
  } catch (e) {
    return c.json({ error: e.message, product: null }, 500);
  }
});
app.post("/api/products", async (c) => {
  try {
    await initDB(c.env.DB);
    const body = await c.req.json();
    const { title, description, price, token = "USDC", image = "", category = "Other", stock = 1, seller_id } = body;
    if (!title || !description || !price || !seller_id)
      return c.json({ error: "Missing required fields: title, description, price, seller_id" }, 400);
    if (Number(price) <= 0)
      return c.json({ error: "Price must be greater than 0" }, 400);
    if (!["USDC", "EURC"].includes(token))
      return c.json({ error: "Token must be USDC or EURC" }, 400);
    const product = await store.create(c.env, {
      title: String(title).trim(),
      description: String(description).trim(),
      price: Number(price),
      token: String(token),
      image: String(image || ""),
      category: String(category),
      stock: Number(stock) || 1,
      seller_id: String(seller_id)
    });
    return c.json({ product, success: true }, 201);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
app.delete("/api/products/:id", async (c) => {
  try {
    await initDB(c.env.DB);
    const { seller_id } = await c.req.json();
    const row = await store.getAny(c.env, c.req.param("id"));
    if (!row) return c.json({ error: "Product not found" }, 404);
    if (row.seller_id !== seller_id) return c.json({ error: "Unauthorized" }, 403);
    await store.setStatus(c.env, c.req.param("id"), "deleted");
    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
app.patch("/api/products/:id/status", async (c) => {
  try {
    await initDB(c.env.DB);
    const { seller_id, status } = await c.req.json();
    if (!["active", "paused", "deleted"].includes(status))
      return c.json({ error: "Invalid status. Use active, paused, or deleted" }, 400);
    const row = await store.getAny(c.env, c.req.param("id"));
    if (!row) return c.json({ error: "Product not found" }, 404);
    if (row.seller_id !== seller_id) return c.json({ error: "Unauthorized" }, 403);
    await store.setStatus(c.env, c.req.param("id"), status);
    return c.json({ success: true, status });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});
app.get("/api/seller/:address/products", async (c) => {
  try {
    await initDB(c.env.DB);
    const products = await store.listBySeller(c.env, c.req.param("address"));
    return c.json({ products, total: products.length });
  } catch (e) {
    return c.json({ products: [], total: 0, error: e.message });
  }
});
app.get("/api/orders", (c) => {
  return c.json({
    orders: [],
    total: 0,
    source: "escrow_contract",
    message: "No orders yet."
  });
});
app.get("/api/stats", (c) => {
  return c.json({
    note: "Stats are fetched live from Arc Network \u2014 see /api/arc-config for RPC endpoint",
    explorer: ARC.explorer,
    faucet: ARC.faucet
  });
});
app.post("/api/orders", async (c) => {
  const body = await c.req.json();
  if (!body.txHash || !body.buyerAddress || !body.sellerAddress) {
    return c.json({ error: "Missing required fields: txHash, buyerAddress, sellerAddress" }, 400);
  }
  if (body.txHash.startsWith("PENDING_") || body.txHash === "0x") {
    return c.json({ error: "Invalid txHash \u2014 must be a real on-chain transaction hash" }, 400);
  }
  const escrowAddr = c.env.SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow;
  const order = {
    id: body.orderId || `ORD-${Date.now()}`,
    txHash: body.txHash,
    fundTxHash: body.fundTxHash || null,
    // fundEscrow tx hash
    buyerAddress: body.buyerAddress,
    sellerAddress: body.sellerAddress,
    escrowContract: escrowAddr,
    // always ShuklyEscrow address
    orderId32: body.orderId32 || null,
    // bytes32 used on-chain
    amount: body.amount,
    token: body.token,
    productId: body.productId,
    items: body.items || [],
    status: "escrow_locked",
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    explorerUrl: `${ARC.explorer}/tx/${body.fundTxHash || body.txHash}`
  };
  return c.json({ order, success: true });
});
var _qrSessions = /* @__PURE__ */ new Map();
async function arcRpc(method, params) {
  const res = await fetch(ARC.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8e3)
  });
  if (!res.ok) throw new Error(`Arc RPC ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`Arc RPC error: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}
app.post("/api/payment/qr-checkout", async (c) => {
  try {
    const body = await c.req.json();
    const { cart, token = "USDC", sellerAddress } = body;
    if (!cart || !Array.isArray(cart) || cart.length === 0)
      return c.json({ error: "cart is required and must not be empty" }, 400);
    if (!["USDC", "EURC"].includes(token))
      return c.json({ error: "token must be USDC or EURC" }, 400);
    if (!sellerAddress || !sellerAddress.startsWith("0x"))
      return c.json({ error: "sellerAddress is required" }, 400);
    const total = cart.reduce((s, i) => s + (parseFloat(i.price) || 0) * (i.quantity || i.qty || 1), 0);
    if (total <= 0) return c.json({ error: "total must be > 0" }, 400);
    const fee = total * 0.015;
    const grandTotal = parseFloat((total + fee).toFixed(6));
    const tokenAddress = token === "EURC" ? ARC.contracts.EURC : ARC.contracts.USDC;
    const escrowAddress = ARC.contracts.ShuklyEscrow;
    const amountWei = BigInt(Math.round(grandTotal * 1e6)).toString();
    const sid = "QR-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
    const orderId = "ORD-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
    const session = {
      sid,
      orderId,
      escrowAddress,
      token,
      tokenAddress,
      sellerAddress,
      cart,
      amount: grandTotal,
      amountWei,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1e3,
      // 30 min TTL
      used: false,
      confirmed: false,
      txHash: null
    };
    try {
      const env = c.env;
      if (env?.KV) {
        await env.KV.put(`qr_session:${sid}`, JSON.stringify(session), { expirationTtl: 1800 });
      } else {
        _qrSessions.set(sid, session);
      }
    } catch (_) {
      _qrSessions.set(sid, session);
    }
    return c.json({
      sid,
      orderId,
      escrowAddress,
      token,
      tokenAddress,
      amount: grandTotal,
      amountWei,
      expiresAt: session.expiresAt,
      // EIP-681 URI for QR code
      paymentUri: `ethereum:${tokenAddress}/transfer?address=${escrowAddress}&uint256=${amountWei}`,
      instructions: `Send exactly ${grandTotal} ${token} to the escrow address`
    });
  } catch (err) {
    console.error("[qr-checkout]", err);
    return c.json({ error: "Server error: " + (err.message || String(err)) }, 500);
  }
});
app.get("/api/payment/poll/:sid", async (c) => {
  const sid = c.req.param("sid");
  const fromParam = (c.req.query("from") || "").trim().toLowerCase();
  let session = null;
  try {
    const env = c.env;
    if (env?.KV) {
      const raw2 = await env.KV.get(`qr_session:${sid}`);
      if (raw2) session = JSON.parse(raw2);
    }
  } catch (_) {
  }
  if (!session) session = _qrSessions.get(sid);
  if (!session) return c.json({ error: "Session not found or expired" }, 404);
  if (session.expiresAt < Date.now())
    return c.json({ status: "expired", error: "Payment window expired (30 min)" }, 410);
  if (session.confirmed)
    return c.json({ status: "confirmed", txHash: session.txHash, orderId: session.orderId });
  try {
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const escrowTopic = "0x000000000000000000000000" + session.escrowAddress.toLowerCase().replace("0x", "");
    const latestHex = await arcRpc("eth_blockNumber", []);
    const latest = parseInt(latestHex, 16);
    const fromBlock = "0x" + Math.max(0, latest - 200).toString(16);
    const fromTopic = fromParam && /^0x[0-9a-f]{40}$/.test(fromParam) ? "0x000000000000000000000000" + fromParam.replace("0x", "") : null;
    const logs = await arcRpc("eth_getLogs", [{
      fromBlock,
      toBlock: "latest",
      address: session.tokenAddress,
      // USDC or EURC contract
      topics: [
        TRANSFER_TOPIC,
        fromTopic,
        // from: pinned address OR any
        escrowTopic
        // to: escrow address (padded)
      ]
    }]);
    if (!Array.isArray(logs) || logs.length === 0)
      return c.json({ status: "pending", message: "No transfer detected yet" });
    const amountWei = BigInt(session.amountWei);
    let matchedTx = null;
    for (const log of logs) {
      if (!log.data || log.data === "0x") continue;
      const logValue = BigInt(log.data);
      const diff = logValue > amountWei ? logValue - amountWei : amountWei - logValue;
      const tolerance = BigInt(1e3);
      if (diff > tolerance) continue;
      if (fromParam && fromParam !== "") {
        const topic1 = (log.topics?.[1] || "").toLowerCase();
        const logFrom = "0x" + topic1.slice(-40);
        if (logFrom !== fromParam) continue;
      }
      matchedTx = log.transactionHash;
      break;
    }
    if (!matchedTx)
      return c.json({ status: "pending", message: "Transfer found but amount mismatch" });
    session.confirmed = true;
    session.txHash = matchedTx;
    session.used = true;
    try {
      const env = c.env;
      if (env?.KV) {
        await env.KV.put(`qr_session:${sid}`, JSON.stringify(session), { expirationTtl: 86400 });
      } else {
        _qrSessions.set(sid, session);
      }
    } catch (_) {
      _qrSessions.set(sid, session);
    }
    return c.json({
      status: "confirmed",
      txHash: matchedTx,
      orderId: session.orderId,
      amount: session.amount,
      token: session.token,
      explorer: `${ARC.explorer}/tx/${matchedTx}`
    });
  } catch (err) {
    console.error("[payment/poll]", err);
    return c.json({ status: "error", message: err.message || "RPC error" }, 500);
  }
});
app.get("/api/escrow/address", (c) => {
  const addr = c.env.SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow;
  return c.json({
    address: addr,
    deployed: addr !== "0x0000000000000000000000000000000000000000",
    verified: addr === "0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511",
    explorer: `${ARC.explorer}/address/${addr}`,
    verified_url: `https://testnet.arcscan.app/address/${addr}`
  });
});
app.get("/api/escrow/abi", async (c) => {
  try {
    const addr = c.env.SHUKLY_ESCROW_ADDRESS || ARC.contracts.ShuklyEscrow;
    const resp = await fetch(`https://testnet.arcscan.app/api/v2/smart-contracts/${addr}`);
    if (!resp.ok) throw new Error(`ArcScan API error: ${resp.status}`);
    const data = await resp.json();
    return c.json({
      address: addr,
      abi: data.abi,
      name: data.name,
      compiler_version: data.compiler_version,
      optimization_enabled: data.optimization_enabled,
      optimization_runs: data.optimization_runs,
      license_type: data.license_type,
      is_verified: data.is_verified,
      is_fully_verified: data.is_fully_verified,
      verified_at: data.verified_at,
      explorer_url: `https://testnet.arcscan.app/address/${addr}`
    });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});
app.post("/api/escrow/save-address", async (c) => {
  const body = await c.req.json();
  if (!body.address || !body.address.startsWith("0x") || body.address.length !== 42) {
    return c.json({ error: "Invalid address" }, 400);
  }
  return c.json({ success: true, address: body.address, message: "Store SHUKLY_ESCROW_ADDRESS as a Cloudflare secret to persist across deployments." });
});
app.post("/api/ai-search", async (c) => {
  try {
    const { query, context } = await c.req.json();
    await initDB(c.env.DB);
    const allProducts = await store.list(c.env);
    let message = "";
    let results = [];
    if (!query || query.trim() === "") {
      message = context?.page === "product" && context?.productName ? `I can help you with "${context.productName}" or find similar items. What would you like to know?` : "Ask me about products, prices, or how to buy on Arc Network!";
      results = allProducts.slice(0, 3);
    } else {
      const searchTerm = query.toLowerCase();
      results = allProducts.filter(
        (p) => p.title.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm) || p.category.toLowerCase().includes(searchTerm)
      );
      if (results.length > 0) {
        message = context?.page === "product" && context?.productName ? `Found ${results.length} product${results.length > 1 ? "s" : ""} matching "${query}". Here are some options similar to "${context.productName}":` : `Found ${results.length} product${results.length > 1 ? "s" : ""} for "${query}" on Arc Network:`;
      } else {
        message = context?.page === "product" ? `No exact matches for "${query}". Here are other products you might like:` : `No products found for "${query}". Try searching by category (Electronics, Fashion, etc.) or browse all items!`;
        results = allProducts.slice(0, 3);
      }
    }
    const formattedResults = results.slice(0, 5).map((p) => ({
      id: p.id,
      name: p.title,
      price: p.price,
      token: p.token,
      category: p.category
    }));
    return c.json({ message, results: formattedResults });
  } catch (error) {
    return c.json({
      message: "Error searching products. Please try again.",
      results: []
    });
  }
});
app.get("/", (c) => c.html(homePage()));
app.get("/marketplace", (c) => c.html(marketplacePage()));
app.get("/product/:id", async (c) => {
  try {
    await initDB(c.env.DB);
    const product = await store.get(c.env, c.req.param("id"));
    if (product) return c.html(productPage(product));
  } catch {
  }
  return c.html(productNotFoundPage(c.req.param("id")));
});
app.get("/cart", (c) => c.html(cartPage()));
app.get("/checkout", (c) => c.html(checkoutPage()));
app.get("/wallet", (c) => c.html(walletPage()));
app.get("/wallet/create", (c) => c.redirect("/wallet"));
app.get("/wallet/import", (c) => c.redirect("/wallet"));
app.get("/orders", (c) => c.html(ordersPage()));
app.get("/orders/:id", (c) => c.html(orderDetailPage(c.req.param("id"))));
app.get("/sell", (c) => c.html(sellPage()));
app.get("/dashboard", (c) => c.html(sellerDashboardPage()));
app.get("/profile", (c) => c.html(profilePage()));
app.get("/register", (c) => c.html(registerPage()));
app.get("/login", (c) => c.html(loginPage()));
app.get("/disputes", (c) => c.html(disputesPage()));
app.get("/notifications", (c) => c.html(notificationsPage()));
app.get("/terms", (c) => c.html(termsPage()));
app.get("/privacy", (c) => c.html(privacyPage()));
app.get("/disclaimer", (c) => c.html(disclaimerPage()));
app.get("/about", (c) => c.html(aboutPage()));
app.get("/deploy-escrow", (c) => c.html(deployEscrowPage()));
var src_default = app;
var ARC_CLIENT_CONFIG = JSON.stringify({
  chainId: ARC.chainId,
  chainIdHex: ARC.chainIdHex,
  rpc: ARC.rpc,
  rpcAlt: ARC.rpcAlt,
  explorer: ARC.explorer,
  faucet: ARC.faucet,
  networkName: ARC.networkName,
  currency: ARC.currency,
  contracts: ARC.contracts
});
function shell(title, body, extraHead = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} | Shukly Store</title>
  
  <!-- Open Graph Meta Tags -->
  <meta property="og:title" content="Shukly Store \u2013 Web3 Marketplace"/>
  <meta property="og:description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta property="og:image" content="https://www.genspark.ai/api/files/s/eSPDBk0I"/>
  <meta property="og:url" content="https://shukly-store.pages.dev/"/>
  <meta property="og:type" content="website"/>
  <meta property="og:site_name" content="Shukly Store"/>
  
  <!-- Twitter Card Meta Tags -->
  <meta name="twitter:card" content="summary_large_image"/>
  <meta name="twitter:title" content="Shukly Store \u2013 Web3 Marketplace"/>
  <meta name="twitter:description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta name="twitter:image" content="https://www.genspark.ai/api/files/s/eSPDBk0I"/>
  
  <!-- Additional Meta Tags -->
  <meta name="description" content="Decentralized marketplace powered by smart contracts on Arc Testnet. Explore, test, and experience Web3 commerce in a secure environment."/>
  <meta name="keywords" content="Web3, marketplace, decentralized, Arc Network, smart contracts, blockchain, DeFi, crypto commerce"/>
  <meta name="theme-color" content="#dc2626"/>
  
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            hawk: {
              50:'#fff1f1',100:'#ffe1e1',200:'#ffc7c7',300:'#ffa0a0',
              400:'#ff6b6b',500:'#ef4444',600:'#dc2626',700:'#b91c1c',
              800:'#991b1b',900:'#7f1d1d'
            }
          },
          fontFamily: { sans: ['Inter','system-ui','sans-serif'] }
        }
      }
    }
  </script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',sans-serif;background:#f8fafc;color:#1e293b}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-track{background:#f1f5f9}
    ::-webkit-scrollbar-thumb{background:#dc2626;border-radius:3px}
    .badge-escrow{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
    .btn-primary{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(220,38,38,0.4)}
    .btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
    .btn-secondary{background:#fff;color:#dc2626;border:2px solid #dc2626;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:6px;text-decoration:none}
    .btn-secondary:hover{background:#fff1f1}
    .card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #f1f5f9}
    .product-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #f1f5f9;overflow:hidden;transition:all .2s}
    .product-card:hover{transform:translateY(-4px);box-shadow:0 8px 25px rgba(0,0,0,.12)}
    .star{color:#f59e0b}
    .tag{background:#fef2f2;color:#dc2626;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600}
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px}
    .modal{background:#fff;border-radius:16px;padding:32px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto}
    .input{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:14px;outline:none;transition:border-color .2s}
    .input:focus{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,.1)}
    .select{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px;font-size:14px;outline:none;background:#fff;cursor:pointer}
    .select:focus{border-color:#dc2626}
    .toast{position:fixed;top:20px;right:20px;z-index:9999;background:#1e293b;color:#fff;padding:12px 20px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);font-size:14px;transform:translateX(120%);transition:transform .3s;max-width:340px}
    .toast.show{transform:translateX(0)}
    .toast.success{background:#16a34a}
    .toast.error{background:#dc2626}
    .toast.info{background:#0ea5e9}
    .toast.warning{background:#d97706}
    #testnet-banner{background:#fee2e2;border-bottom:1px solid #fca5a5;color:#7f1d1d;font-size:13px;font-weight:500;display:flex;align-items:center;justify-content:center;padding:8px 48px 8px 16px;position:sticky;top:0;z-index:200;min-height:36px;line-height:1.4;text-align:center}
    #testnet-banner .banner-text{flex:1;text-align:center}
    #testnet-banner .banner-close{position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;color:#991b1b;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:4px;font-size:16px;line-height:1;transition:background .15s,color .15s;padding:0}
    #testnet-banner .banner-close:hover{background:#fca5a5;color:#450a0a}
    nav{background:#fff;border-bottom:1px solid #f1f5f9;position:sticky;top:36px;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.06)}
    body.banner-hidden nav{top:0}
    footer{background:#1e293b;color:#94a3b8;padding:48px 0 24px}
    .hero-gradient{background:linear-gradient(135deg,#fff1f1 0%,#fef2f2 30%,#fff 60%,#f8fafc 100%)}
    .loading-spinner{display:inline-block;width:20px;height:20px;border:2px solid #f3f3f3;border-top:2px solid #dc2626;border-radius:50%;animation:spin 1s linear infinite}
    .loading-spinner-lg{display:inline-block;width:40px;height:40px;border:3px solid #f1f5f9;border-top:3px solid #dc2626;border-radius:50%;animation:spin 1s linear infinite}
    @keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .step-circle{width:32px;height:32px;border-radius:50%;background:#dc2626;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
    .step-circle.done{background:#16a34a}
    .step-circle.pending{background:#e2e8f0;color:#94a3b8}
    .seed-word{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;font-family:monospace;font-size:13px;font-weight:600;color:#dc2626;text-align:center}
    .wallet-card{background:linear-gradient(135deg,#dc2626 0%,#991b1b 50%,#7f1d1d 100%);color:#fff;border-radius:16px;padding:24px}
    .chat-bubble-user{background:#fef2f2;border-radius:12px 12px 2px 12px;padding:10px 14px;max-width:80%}
    .chat-bubble-ai{background:#fff;border:1px solid #f1f5f9;border-radius:12px 12px 12px 2px;padding:10px 14px;max-width:85%}
    .sidebar-nav a{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;color:#64748b;font-size:14px;font-weight:500;text-decoration:none;transition:all .15s}
    .sidebar-nav a:hover,.sidebar-nav a.active{background:#fef2f2;color:#dc2626}
    .notification-item{border-left:3px solid #dc2626;padding:12px 16px;background:#fff;border-radius:0 8px 8px 0;margin-bottom:8px}
    .empty-state{text-align:center;padding:48px 24px;color:#94a3b8}
    .empty-state i{font-size:48px;margin-bottom:16px;opacity:.3;display:block}
    .demo-disclaimer{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 16px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px;line-height:1.4}
    .trust-box{background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:12px 16px;font-size:12px;color:#14532d;display:flex;align-items:flex-start;gap:8px;line-height:1.5}
    .legal-page h1{font-size:1.75rem;font-weight:800;color:#1e293b;margin-bottom:.5rem}
    .legal-page h2{font-size:1.1rem;font-weight:700;color:#1e293b;margin:1.5rem 0 .5rem}
    .legal-page p{color:#475569;line-height:1.7;margin-bottom:.75rem;font-size:.9rem}
    .legal-page ul{color:#475569;line-height:1.7;margin-bottom:.75rem;font-size:.9rem;padding-left:1.25rem;list-style:disc}
    .tx-confirm-modal{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}
    .arc-badge{background:linear-gradient(135deg,#1e40af,#1d4ed8);color:#fff;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px}
    .network-warning{background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:12px 16px;font-size:13px;color:#92400e;display:flex;align-items:center;gap:8px}
    .network-ok{background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:12px 16px;font-size:13px;color:#166534;display:flex;align-items:center;gap:8px}
    .addr-mono{font-family:monospace;font-size:12px;word-break:break-all}
  </style>
  ${extraHead}
  <!-- Arc Network client config (injected server-side) -->
  <script>
    window.ARC = ${ARC_CLIENT_CONFIG};
  </script>
  <!-- ethers.js v6 via CDN for wallet + RPC interaction -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js"></script>
  <!-- Arc Commerce \u2014 Circle USDC payment service layer (non-destructive extension) -->
  <script src="/static/arcPayments.js" defer></script>
</head>
<body>
  <!-- Testnet Banner -->
  <div id="testnet-banner" role="alert" aria-label="Testnet notice">
    <span class="banner-text">\u26A0\uFE0F This app is running on <strong>TESTNET</strong>. All transactions are for testing purposes only.</span>
    <button class="banner-close" onclick="dismissTestnetBanner()" aria-label="Dismiss testnet banner" title="Dismiss">&#x2715;</button>
  </div>
  <script>
    // Testnet banner dismiss \u2014 runs before DOMContentLoaded for zero flicker
    (function(){
      if(localStorage.getItem('hideTestnetBanner')==='true'){
        var b=document.getElementById('testnet-banner');
        if(b){b.style.display='none';}
        document.body.classList.add('banner-hidden');
      }
    })();
    function dismissTestnetBanner(){
      var b=document.getElementById('testnet-banner');
      if(b){b.style.display='none';}
      document.body.classList.add('banner-hidden');
      localStorage.setItem('hideTestnetBanner','true');
    }
  </script>

  ${navbar()}
  ${body}
  ${chatWidget()}
  ${toastContainer()}
  ${globalScript()}
</body>
</html>`;
}
function globalScript() {
  return `<script>
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
//  ARC NETWORK \u2014 Real wallet integration
//  Chain ID: 5042002 (Arc Testnet)
//  RPC: https://rpc.testnet.arc.network
//  USDC: 0x3600000000000000000000000000000000000000 (6 dec)
//  EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a (6 dec)
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

const ARC_CHAIN_ID = window.ARC.chainId;
const ARC_CHAIN_ID_HEX = window.ARC.chainIdHex;
const ARC_RPC = window.ARC.rpc;
const ARC_EXPLORER = window.ARC.explorer;
const USDC_ADDRESS = window.ARC.contracts.USDC;
const EURC_ADDRESS = window.ARC.contracts.EURC;

// ShuklyEscrow address \u2014 loaded from localStorage (set after deploy) or ARC config
// Priority: localStorage override \u2192 ARC config (hardcoded) \u2192 zero address (not deployed)
function getEscrowAddress() {
  const local = localStorage.getItem('shukly_escrow_address');
  if (local && local !== '0x0000000000000000000000000000000000000000') return local;
  const fromConfig = window.ARC && window.ARC.contracts && window.ARC.contracts.ShuklyEscrow;
  if (fromConfig && fromConfig !== '0x0000000000000000000000000000000000000000') return fromConfig;
  return '0x0000000000000000000000000000000000000000';
}

// Check if escrow address is valid (non-zero)
function isEscrowDeployed() {
  const addr = getEscrowAddress();
  return addr && addr !== '0x0000000000000000000000000000000000000000';
}

// Minimal ERC-20 ABI for balanceOf + approve + allowance
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// \u2500\u2500\u2500 ShuklyEscrow ABI \u2014 direct wallet calls (no relayer) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// States: 0=EMPTY, 1=FUNDED, 2=CONFIRMED, 3=RELEASED, 4=REFUNDED, 5=DISPUTED
const ESCROW_ABI = [
  'function createEscrow(bytes32 orderId, address seller, address token, uint256 amount) external',
  'function fundEscrow(bytes32 orderId) external',
  'function confirmDelivery(bytes32 orderId) external',
  'function releaseFunds(bytes32 orderId) external',
  'function refund(bytes32 orderId) external',
  'function openDispute(bytes32 orderId) external',
  'function getEscrow(bytes32 orderId) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
  'function escrows(bytes32) external view returns (address buyer, address seller, address token, uint256 amount, uint8 state, uint256 createdAt)',
  'function owner() external view returns (address)',
  'function feeBps() external view returns (uint256)',
  'event EscrowCreated(bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount)',
  'event EscrowFunded(bytes32 indexed orderId, address indexed buyer, uint256 amount)',
  'event DeliveryConfirmed(bytes32 indexed orderId, address indexed buyer)',
  'event FundsReleased(bytes32 indexed orderId, address indexed seller, uint256 amount)',
  'event EscrowRefunded(bytes32 indexed orderId, address indexed buyer, uint256 amount)',
  'event DisputeOpened(bytes32 indexed orderId, address indexed opener)'
];

// \u2500 Toast \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function showToast(msg, type='info') {
  const t = document.getElementById('global-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + type;
  setTimeout(() => { t.className = 'toast ' + type }, 4000);
}

// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//  CartStore  \u2014 single source of truth, key = "cart"
//  Structure per item: { id, title, price, currency, quantity, image }
// \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
const CART_KEY = 'cart';

const CartStore = {
  /** Read cart from localStorage \u2014 always fresh */
  getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
    catch { return []; }
  },

  /** Persist cart to localStorage and sync all UI */
  _save(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    CartStore._syncBadge(cart);
  },

  /** Add or increment an item.
   *  Accepts any shape: normalises to { id, title, price, currency, quantity, image } */
  addToCart(product) {
    const cart = CartStore.getCart();
    // Normalise field names (support both old and new shapes)
    const id       = product.id;
    const title    = product.title || product.name || 'Product';
    const price    = parseFloat(product.price) || 0;
    const currency = product.currency || product.token || 'USDC';
    const image    = product.image || '';
    const idx      = cart.findIndex(i => i.id === id);
    if (idx >= 0) {
      cart[idx].quantity = (cart[idx].quantity || 1) + 1;
    } else {
      cart.push({ id, title, price, currency, quantity: 1, image });
    }
    CartStore._save(cart);
    showToast(title + ' added to cart!', 'success');
    return cart;
  },

  /** Remove a single item by id */
  removeFromCart(productId) {
    const cart = CartStore.getCart().filter(i => i.id !== productId);
    CartStore._save(cart);
    return cart;
  },

  /** Change quantity (+1 or -1). Removes item if qty would drop below 1. */
  changeQty(productId, delta) {
    const cart = CartStore.getCart();
    const idx  = cart.findIndex(i => i.id === productId);
    if (idx >= 0) {
      cart[idx].quantity = Math.max(1, (cart[idx].quantity || 1) + delta);
      CartStore._save(cart);
    }
    return CartStore.getCart();
  },

  /** Empty the cart */
  clearCart() {
    CartStore._save([]);
    return [];
  },

  /** Update the navbar badge */
  _syncBadge(cart) {
    const total = (cart || CartStore.getCart()).reduce((s, i) => s + (i.quantity || i.qty || 1), 0);
    const el = document.getElementById('cart-badge');
    if (el) { el.textContent = total; el.style.display = total > 0 ? 'flex' : 'none'; }
  },

  /** Migrate items saved under old keys to the canonical key */
  _migrate() {
    // Migrate 'rh_cart' (old global key)
    const old1 = localStorage.getItem('rh_cart');
    if (old1 && !localStorage.getItem(CART_KEY)) {
      try {
        const items = JSON.parse(old1).map(i => ({
          id: i.id, title: i.title || i.name || 'Product',
          price: parseFloat(i.price) || 0,
          currency: i.currency || i.token || 'USDC',
          quantity: i.qty || i.quantity || 1, image: i.image || ''
        }));
        localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch {}
    }
    // Migrate 'rhawk_cart' (product-page key)
    const old2 = localStorage.getItem('rhawk_cart');
    if (old2) {
      try {
        const existing = CartStore.getCart();
        const items    = JSON.parse(old2);
        items.forEach(i => {
          const id = i.id;
          if (!existing.find(e => e.id === id)) {
            existing.push({
              id, title: i.title || i.name || 'Product',
              price: parseFloat(i.price) || 0,
              currency: i.currency || i.token || 'USDC',
              quantity: i.qty || i.quantity || 1, image: i.image || ''
            });
          }
        });
        localStorage.setItem(CART_KEY, JSON.stringify(existing));
        localStorage.removeItem('rhawk_cart');
      } catch {}
    }
    localStorage.removeItem('rh_cart');
  }
};

// \u2500\u2500 Backward-compat shims (keep old call-sites working) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function getCart()          { return CartStore.getCart(); }
function saveCart(c)        { CartStore._save(c); }
function addToCart(product) { CartStore.addToCart(product); }
function updateCartBadge()  { CartStore._syncBadge(); }

// \u2500 Wallet state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
let _walletAddress = null;
let _walletProvider = null;
let _ethersProvider = null;

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
//  AES-256-GCM Wallet Encryption \u2014 Web Crypto API (client-side only)
//  Keys derived via PBKDF2 (SHA-256, 200_000 iterations, 256-bit)
//  Storage key: rh_wallet_enc  (encrypted)  \u2192 persistent
//  Session key: rh_wallet_sess (plain JSON) \u2192 sessionStorage only
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

async function _walletDeriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function walletEncrypt(walletObj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv   = crypto.getRandomValues(new Uint8Array(12));
  const key  = await _walletDeriveKey(password, salt);
  const enc  = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(walletObj))
  );
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    encryptedWallet: toB64(ciphertext),
    iv:   toB64(iv),
    salt: toB64(salt),
    v: 1
  };
}

async function walletDecrypt(encData, password) {
  try {
    const fromB64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const salt = fromB64(encData.salt);
    const iv   = fromB64(encData.iv);
    const ct   = fromB64(encData.encryptedWallet);
    const key  = await _walletDeriveKey(password, salt);
    const dec  = new TextDecoder();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(dec.decode(plain));
  } catch {
    return null; // wrong password or corrupted
  }
}

// Save encrypted wallet to localStorage (persists across sessions)
async function storeWalletEncrypted(walletObj, password) {
  const enc = await walletEncrypt(walletObj, password);
  localStorage.setItem('rh_wallet_enc', JSON.stringify(enc));
  // Also activate session immediately
  sessionStorage.setItem('rh_wallet_sess', JSON.stringify(walletObj));
}

// Checks if there is an encrypted wallet stored (not yet unlocked)
function hasEncryptedWallet() {
  try {
    const enc = localStorage.getItem('rh_wallet_enc');
    if (!enc) return false;
    const parsed = JSON.parse(enc);
    return !!(parsed && parsed.encryptedWallet && parsed.iv && parsed.salt);
  } catch { return false; }
}

// Unlock: decrypt stored wallet with password, activate session
async function unlockWallet(password) {
  try {
    const enc = JSON.parse(localStorage.getItem('rh_wallet_enc') || 'null');
    if (!enc) return null;
    const w = await walletDecrypt(enc, password);
    if (!w) return null;
    sessionStorage.setItem('rh_wallet_sess', JSON.stringify(w));
    return w;
  } catch { return null; }
}

// getStoredWallet \u2014 returns active wallet from session OR legacy plain rh_wallet
function getStoredWallet() {
  // 1. Check session (unlocked this tab/session)
  try {
    const sess = sessionStorage.getItem('rh_wallet_sess');
    if (sess) return JSON.parse(sess);
  } catch { /* ignore */ }
  // 2. Legacy plain-text wallet (backwards compatibility)
  try {
    const plain = localStorage.getItem('rh_wallet');
    if (plain) {
      const w = JSON.parse(plain);
      // If it has a privateKey in plain text, put in session and continue
      if (w && w.address) {
        sessionStorage.setItem('rh_wallet_sess', plain);
        return w;
      }
    }
  } catch { /* ignore */ }
  return null;
}

// storeWallet \u2014 legacy plain text (used by MetaMask connect flow)
function storeWallet(w) {
  localStorage.setItem('rh_wallet', JSON.stringify(w));
  sessionStorage.setItem('rh_wallet_sess', JSON.stringify(w));
}

function clearWallet() {
  localStorage.removeItem('rh_wallet');
  localStorage.removeItem('rh_wallet_enc');
  sessionStorage.removeItem('rh_wallet_sess');
}

function updateWalletBadge(address) {
  const el = document.getElementById('wallet-badge');
  if (el) el.textContent = address ? address.substring(0,8)+'\u2026' : 'Wallet';
  _walletAddress = address || null;
}

// \u2500 Arc Network chain helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function switchToArc() {
  if (!window.ethereum) return false;
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARC_CHAIN_ID_HEX }]
    });
    return true;
  } catch (switchErr) {
    if (switchErr.code === 4902) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: ARC_CHAIN_ID_HEX,
            chainName: 'Arc Testnet',
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
            rpcUrls: [ARC_RPC, 'https://rpc.blockdaemon.testnet.arc.network'],
            blockExplorerUrls: [ARC_EXPLORER]
          }]
        });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

async function isOnArcNetwork() {
  if (!window.ethereum) return false;
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    return parseInt(chainId, 16) === ARC_CHAIN_ID;
  } catch { return false; }
}

// \u2500 Real balance fetch from Arc Network RPC \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function fetchArcBalances(address) {
  if (!address) return { usdc: '0.00', eurc: '0.00', raw: { usdc: 0n, eurc: 0n } };
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC);

    // USDC: Arc native (also ERC-20 with 6 decimals)
    let usdcRaw = 0n;
    try {
      // First try native balance (USDC is native on Arc)
      const nativeBal = await provider.getBalance(address);
      // Arc native balance is in 18-decimal form for USDC
      // Convert: native / 1e12 gives 6-decimal USDC
      usdcRaw = nativeBal / BigInt('1000000000000');
    } catch {
      // Fallback: ERC-20 balanceOf
      try {
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
        usdcRaw = await usdcContract.balanceOf(address);
      } catch { usdcRaw = 0n; }
    }

    // EURC: standard ERC-20 (6 decimals)
    let eurcRaw = 0n;
    try {
      const eurcContract = new ethers.Contract(EURC_ADDRESS, ERC20_ABI, provider);
      eurcRaw = await eurcContract.balanceOf(address);
    } catch { eurcRaw = 0n; }

    const formatBalance = (raw) => {
      const val = Number(raw) / 1e6;
      return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    };

    return {
      usdc: formatBalance(usdcRaw),
      eurc: formatBalance(eurcRaw),
      raw: { usdc: usdcRaw, eurc: eurcRaw }
    };
  } catch (err) {
    console.error('Balance fetch error:', err.message);
    return { usdc: '\u2014', eurc: '\u2014', error: err.message, raw: { usdc: 0n, eurc: 0n } };
  }
}

// \u2500 Connect wallet \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function connectWallet(type) {
  if (type === 'metamask') {
    if (!window.ethereum) {
      showToast('MetaMask not detected. Install from metamask.io', 'error');
      window.open('https://metamask.io/download/', '_blank');
      return;
    }
    try {
      showToast('Connecting to MetaMask\u2026', 'info');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts.length) { showToast('No accounts found', 'error'); return; }
      const address = accounts[0];

      // Switch to Arc Network
      const onArc = await isOnArcNetwork();
      if (!onArc) {
        showToast('Switching to Arc Testnet\u2026', 'info');
        const switched = await switchToArc();
        if (!switched) {
          showToast('Please manually switch to Arc Testnet (Chain ID: 5042002)', 'warning');
        }
      }

      const walletData = {
        address,
        type: 'metamask',
        network: 'Arc Testnet',
        chainId: ARC_CHAIN_ID,
        connectedAt: new Date().toISOString()
      };
      storeWallet(walletData);
      updateWalletBadge(address);
      showToast('MetaMask connected to Arc Network!', 'success');
      return walletData;
    } catch (err) {
      if (err.code === 4001) showToast('Connection rejected by user', 'error');
      else showToast('MetaMask error: ' + err.message, 'error');
      return null;
    }
  }

  if (type === 'walletconnect') {
    showToast('WalletConnect: scan QR with your wallet and select Arc Testnet (Chain ID: 5042002)', 'info');
    return null;
  }

  if (type === 'internal') {
    const w = getStoredWallet();
    if (w && w.type === 'internal') {
      updateWalletBadge(w.address);
      return w;
    }
    window.location.href = '/wallet';
    return null;
  }
}

// \u2500 Disconnect wallet \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function disconnectWallet() {
  clearWallet();
  _walletAddress = null;
  updateWalletBadge(null);
  showToast('Wallet disconnected', 'info');
  setTimeout(() => location.reload(), 800);
}

// \u2500 Wallet event listeners (MetaMask) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function setupWalletListeners() {
  if (!window.ethereum) return;
  window.ethereum.on('accountsChanged', (accounts) => {
    if (!accounts.length) {
      clearWallet();
      updateWalletBadge(null);
      showToast('Wallet disconnected', 'info');
      setTimeout(() => location.reload(), 800);
    } else {
      const stored = getStoredWallet();
      if (stored && stored.type === 'metamask') {
        stored.address = accounts[0];
        storeWallet(stored);
        updateWalletBadge(accounts[0]);
        showToast('Account changed: ' + accounts[0].substring(0,10) + '\u2026', 'info');
        setTimeout(() => location.reload(), 800);
      }
    }
  });
  window.ethereum.on('chainChanged', (chainId) => {
    const newChain = parseInt(chainId, 16);
    if (newChain !== ARC_CHAIN_ID) {
      showToast('Wrong network! Please switch to Arc Testnet (Chain ID: 5042002)', 'warning');
    } else {
      showToast('Connected to Arc Testnet \u2713', 'success');
    }
    setTimeout(() => location.reload(), 1000);
  });
  window.ethereum.on('disconnect', () => {
    clearWallet();
    updateWalletBadge(null);
    showToast('Wallet provider disconnected', 'info');
  });
}

// \u2500 Fetch real tx history from Arc explorer API \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function fetchTxHistory(address, limit = 10) {
  if (!address) return [];
  try {
    const url = ARC_EXPLORER + '/api/v2/addresses/' + address + '/transactions?limit=' + limit;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return data.items || data.result || [];
  } catch { return []; }
}

// \u2500 Network indicator banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function checkNetworkStatus(containerEl) {
  if (!containerEl) return;
  if (!window.ethereum) {
    containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>No wallet extension detected. Install MetaMask or create an in-app wallet to use Arc Network.</div>';
    return;
  }
  try {
    const chainId = await window.ethereum.request({ method: 'eth_chainId' });
    const current = parseInt(chainId, 16);
    if (current === ARC_CHAIN_ID) {
      containerEl.innerHTML = '<div class="network-ok"><i class="fas fa-circle text-green-500"></i>Connected to <strong>Arc Testnet</strong> (Chain ID: 5042002) \xB7 <a href="' + ARC_EXPLORER + '" target="_blank" class="underline ml-1">Explorer</a></div>';
    } else {
      containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>Wrong network (Chain ID: ' + current + '). <button onclick="switchToArc().then(()=>location.reload())" class="underline ml-1 font-bold">Switch to Arc Testnet</button></div>';
    }
  } catch {
    containerEl.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>Could not detect network. Make sure your wallet is unlocked.</div>';
  }
}

// \u2500 Init on every page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
document.addEventListener('DOMContentLoaded', () => {
  // 1. Migrate any items saved under old localStorage keys \u2192 canonical 'cart'
  CartStore._migrate();
  // 2. Hydrate cart badge
  updateCartBadge();
  // 3. Wallet listeners
  setupWalletListeners();

  const stored = getStoredWallet();
  if (stored) {
    updateWalletBadge(stored.address);
    // Re-verify MetaMask is still connected
    if (stored.type === 'metamask' && window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then(accounts => {
        if (!accounts.length) {
          clearWallet();
          updateWalletBadge(null);
        }
      }).catch(() => {});
    }
  }
});

// \u2500 Transaction Confirmation Modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function showTxConfirmModal({ action, amount, token, network, note }) {
  return new Promise((resolve) => {
    // Remove any existing modal
    document.getElementById('tx-confirm-modal-root')?.remove();
    const el = document.createElement('div');
    el.id = 'tx-confirm-modal-root';
    el.className = 'tx-confirm-modal';
    el.innerHTML = '<div class="modal" style="max-width:440px">'
      + '<div class="flex items-center gap-3 mb-5">'
      + '<div class="w-12 h-12 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 text-xl shrink-0"><i class="fas fa-shield-alt"></i></div>'
      + '<div><h3 class="text-lg font-extrabold text-slate-800">Blockchain Transaction</h3>'
      + '<p class="text-slate-400 text-xs mt-0.5">Review before signing</p></div></div>'
      + '<div class="bg-slate-50 rounded-xl p-4 mb-4 space-y-2 text-sm">'
      + '<div class="flex justify-between"><span class="text-slate-500">Action</span><span class="font-semibold text-slate-800">' + action + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Amount</span><span class="font-bold text-red-600">' + amount + ' ' + token + '</span></div>'
      + '<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium text-slate-700">' + network + '</span></div>'
      + '</div>'
      + '<div class="trust-box mb-5"><i class="fas fa-info-circle" style="color:#16a34a;flex-shrink:0"></i>'
      + '<span class="text-xs">' + note + '<br/>You are about to sign a blockchain transaction using your connected wallet. <strong>We never sign on your behalf.</strong></span></div>'
      + '<div class="flex gap-3">'
      + '<button id="tx-cancel-btn" class="btn-secondary flex-1 justify-center"><i class="fas fa-times"></i> Cancel</button>'
      + '<button id="tx-confirm-btn" class="btn-primary flex-1 justify-center"><i class="fas fa-lock"></i> Sign & Submit</button>'
      + '</div></div>';
    document.body.appendChild(el);
    document.getElementById('tx-cancel-btn').onclick = () => { el.remove(); resolve(false); };
    document.getElementById('tx-confirm-btn').onclick = () => { el.remove(); resolve(true); };
    el.onclick = (e) => { if(e.target===el){ el.remove(); resolve(false); } };
  });
}

// \u2500 Chat toggle \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('hidden');
}
</script>`;
}
function navbar() {
  return `<nav>
  <div class="max-w-7xl mx-auto px-4 flex items-center justify-between h-16 gap-4">
    <a href="/" class="flex items-center gap-2 shrink-0">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
          <path d="M9 14l3-3 3 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <span class="font-extrabold text-xl tracking-tight text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
    </a>
    <div class="hidden md:flex flex-1 max-w-xl mx-4">
      <div class="relative w-full">
        <input id="nav-search" type="text" placeholder="Search products on Arc Network\u2026" class="w-full pl-10 pr-20 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 bg-slate-50"/>
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
        <button onclick="handleNavSearch()" class="absolute right-2 top-1/2 -translate-y-1/2 bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-red-700">Search</button>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <a href="/marketplace" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-store text-xs"></i> Marketplace
      </a>
      <a href="/sell" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-plus-circle text-xs"></i> Sell
      </a>
      <a href="/dashboard" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-chart-line text-xs"></i> Dashboard
      </a>
      <a href="/about" class="hidden sm:flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
        <i class="fas fa-info-circle text-xs"></i> About Us
      </a>
      <a href="/wallet" id="wallet-nav-btn" class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 transition-colors border border-red-100">
        <i class="fas fa-wallet text-xs"></i>
        <span id="wallet-badge">Wallet</span>
      </a>
      <a href="/notifications" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100">
        <i class="fas fa-bell"></i>
      </a>
      <a href="/cart" class="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100">
        <i class="fas fa-shopping-cart"></i>
        <span id="cart-badge" class="absolute -top-1 -right-1 w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full hidden items-center justify-center">0</span>
      </a>
      <a href="/profile" class="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-sm font-bold hover:opacity-90">
        <i class="fas fa-user text-xs"></i>
      </a>
    </div>
  </div>
  <script>
    function handleNavSearch() {
      const q = document.getElementById('nav-search')?.value.trim();
      if (q) { document.getElementById('chat-panel').classList.remove('hidden'); sendChatMessage(q); }
    }
    document.getElementById('nav-search')?.addEventListener('keydown', e => { if(e.key==='Enter') handleNavSearch() });
  </script>
</nav>`;
}
function toastContainer() {
  return `<div id="global-toast" class="toast"></div>`;
}
function chatWidget() {
  return `
<button onclick="toggleChat()" class="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-red-500 to-red-800 text-white shadow-xl flex items-center justify-center text-xl hover:scale-110 transition-transform z-[300]" title="HawkAI Assistant">
  <i class="fas fa-robot"></i>
</button>
<div id="chat-panel" class="hidden fixed bottom-24 right-6 w-[420px] sm:w-[480px] z-[300]">
  <div class="card shadow-2xl overflow-hidden">
    <div class="bg-gradient-to-r from-red-600 to-red-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
          <i class="fas fa-robot text-white text-sm"></i>
        </div>
        <div>
          <p class="text-white font-semibold text-sm">HawkAI Assistant</p>
          <p class="text-red-200 text-xs">Live on Arc Network</p>
        </div>
      </div>
      <button onclick="toggleChat()" class="text-white/80 hover:text-white"><i class="fas fa-times"></i></button>
    </div>
    <div id="chat-messages" class="p-4 h-[420px] overflow-y-auto flex flex-col gap-3 bg-gray-50">
      <div class="chat-bubble-ai text-sm text-slate-700">
        \u{1F44B} Hi! I'm <strong>HawkAI</strong>, your Web3 shopping assistant.<br/><br/>
        The marketplace is live on <strong>Arc Network</strong> (Chain ID: 5042002).<br/>
        Ask me about products, escrow protection, or how to buy!
      </div>
    </div>
    <div class="p-3 bg-white border-t border-slate-100 flex gap-2">
      <input id="chat-input" type="text" placeholder="Ask about products, prices, or how to buy\u2026" class="flex-1 input py-2 text-sm" onkeydown="if(event.key==='Enter')sendChatMessage()"/>
      <button onclick="sendChatMessage()" class="btn-primary py-2 px-3 text-sm"><i class="fas fa-paper-plane"></i></button>
    </div>
  </div>
</div>
<script>
// Get current page context for chat
function getChatContext() {
  const path = window.location.pathname;
  const ctx = { page: 'home', productId: null, productName: null };
  
  // Product page context
  if (path.startsWith('/product/')) {
    ctx.page = 'product';
    ctx.productId = path.split('/product/')[1];
    const titleEl = document.querySelector('h1.text-3xl');
    if (titleEl) ctx.productName = titleEl.textContent.trim();
  }
  // Marketplace page
  else if (path === '/marketplace') ctx.page = 'marketplace';
  // Cart page
  else if (path === '/cart') ctx.page = 'cart';
  // Checkout page
  else if (path === '/checkout') ctx.page = 'checkout';
  
  return ctx;
}

async function sendChatMessage(overrideText) {
  const input = document.getElementById('chat-input');
  const query = overrideText || (input ? input.value.trim() : '');
  if (!query) return;
  if (input) input.value = '';
  
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML += '<div class="flex justify-end"><div class="chat-bubble-user text-sm text-slate-700">' + query + '</div></div>';
  msgs.innerHTML += '<div id="ai-typing" class="chat-bubble-ai text-sm text-slate-500 flex items-center gap-2"><div class="loading-spinner"></div> Searching Arc Network\u2026</div>';
  msgs.scrollTop = msgs.scrollHeight;
  
  try {
    const context = getChatContext();
    const res = await fetch('/api/ai-search', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ query, context })
    });
    const data = await res.json();
    document.getElementById('ai-typing')?.remove();
    
    let html = '<div class="chat-bubble-ai text-sm text-slate-700">';
    html += '<p class="mb-2">' + data.message + '</p>';
    
    if (data.results && data.results.length > 0) {
      html += '<div class="flex flex-col gap-2">';
      data.results.slice(0,3).forEach(p => {
        html += '<div class="flex items-center gap-2 bg-white rounded-lg p-2 border border-slate-100">'
          + '<div class="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-400"><i class="fas fa-box"></i></div>'
          + '<div class="flex-1 min-w-0"><p class="font-medium text-xs truncate">' + p.name + '</p>'
          + '<p class="text-red-600 font-bold text-xs">' + p.price + ' ' + p.token + '</p></div>'
          + '<a href="/product/' + p.id + '" class="btn-primary text-xs py-1 px-2">View</a></div>';
      });
      html += '</div>';
    } else {
      html += '<p class="text-slate-400 text-xs mt-1">\u{1F4A1} Get test USDC/EURC at <a href="' + ARC.faucet + '" target="_blank" class="text-blue-600 underline">faucet.circle.com</a></p>';
    }
    html += '</div>';
    msgs.innerHTML += html;
  } catch {
    document.getElementById('ai-typing')?.remove();
    msgs.innerHTML += '<div class="chat-bubble-ai text-sm text-red-500">Search error \u2014 Arc Network may be temporarily unreachable.</div>';
  }
  msgs.scrollTop = msgs.scrollHeight;
}
</script>`;
}
function footer() {
  return `<footer style="background:#0f172a;border-top:1px solid #1e293b;padding:32px 0 0;">
    <div class="max-w-7xl mx-auto px-4">

      <!-- Main grid: brand + 3 link columns -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 pb-6 border-b border-slate-800">

        <!-- Brand -->
        <div class="col-span-2 md:col-span-1">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white"/></svg>
            </div>
            <span class="font-bold text-white text-sm">Shukly<span class="text-amber-400"> Store</span></span>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed mb-3 max-w-xs">Decentralized marketplace on Arc Network \u2014 Circle's stablecoin-native L1.</p>
          <div class="flex items-center gap-3 text-xs">
            <span class="flex items-center gap-1.5 text-green-400"><span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse inline-block"></span>Arc Testnet</span>
            <span class="text-slate-600">\xB7</span>
            <span class="text-slate-500">Chain 5042002</span>
          </div>
        </div>

        <!-- Marketplace -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Marketplace</p>
          <ul class="space-y-1.5">
            ${["Browse:/marketplace", "Sell:/sell", "Dashboard:/dashboard", "My Orders:/orders", "Disputes:/disputes"].map((t) => {
    const [l, u] = t.split(":");
    return `<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`;
  }).join("")}
          </ul>
        </div>

        <!-- Wallet -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Wallet</p>
          <ul class="space-y-1.5">
            ${["My Wallet:/wallet", "Profile:/profile"].map((t) => {
    const [l, u] = t.split(":");
    return `<li><a href="${u}" class="text-xs text-slate-500 hover:text-red-400 transition-colors">${l}</a></li>`;
  }).join("")}
          </ul>
        </div>

        <!-- Arc Network -->
        <div>
          <p class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Arc Network</p>
          <ul class="space-y-1.5">
            <li><a href="https://docs.arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Docs</a></li>
            <li><a href="https://testnet.arcscan.app" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">Explorer</a></li>
            <li><a href="https://faucet.circle.com" target="_blank" class="text-xs text-slate-500 hover:text-green-400 transition-colors">Get Test USDC</a></li>
            <li><a href="https://arc.network" target="_blank" class="text-xs text-slate-500 hover:text-red-400 transition-colors">arc.network</a></li>
          </ul>
        </div>
      </div>

      <!-- Notices row \u2014 compact alert strip -->
      <div class="py-3 border-b border-slate-800">
        <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
          <span><i class="fas fa-exclamation-circle text-yellow-500 mr-1"></i><strong class="text-slate-400">Testnet:</strong> No real funds. Testing only.</span>
          <span><i class="fas fa-info-circle text-blue-400 mr-1"></i><strong class="text-slate-400">Demo:</strong> Illustrative products only.</span>
          <span><i class="fas fa-shield-alt text-green-400 mr-1"></i><strong class="text-slate-400">Security:</strong> Keys never leave your device.</span>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
        <span>\xA9 2024 Shukly Store \xB7 Built on Arc Network (Circle)</span>
        <div class="flex items-center gap-3 flex-wrap justify-center">
          <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="flex items-center gap-1 hover:text-white transition-colors"><i class="fab fa-github"></i> GitHub</a>
          <span class="text-slate-700">\xB7</span>
          <a href="https://testnet.arcscan.app/address/${ARC.contracts.FxEscrow}" target="_blank" class="flex items-center gap-1 hover:text-red-400 transition-colors"><i class="fas fa-file-contract text-xs"></i> Escrow</a>
          <span class="text-slate-700">\xB7</span>
          <a href="https://testnet.arcscan.app" target="_blank" class="flex items-center gap-1 hover:text-red-400 transition-colors"><i class="fas fa-external-link-alt text-xs"></i> Explorer</a>
          <span class="text-slate-700">\xB7</span>
          <a href="https://faucet.circle.com" target="_blank" class="flex items-center gap-1 hover:text-green-400 transition-colors"><i class="fas fa-faucet text-xs"></i> Faucet</a>
          <span class="text-slate-700">\xB7</span>
          <a href="/terms" class="hover:text-white transition-colors">Terms</a>
          <span class="text-slate-700">\xB7</span>
          <a href="/privacy" class="hover:text-white transition-colors">Privacy</a>
          <span class="text-slate-700">\xB7</span>
          <a href="/disclaimer" class="hover:text-white transition-colors">Disclaimer</a>
          <span class="text-slate-700">\xB7</span>
          <a href="/about" class="hover:text-white transition-colors">About</a>
        </div>
      </div>

    </div>
  </footer>`;
}
function homePage() {
  const categories = [
    { name: "Electronics", icon: "fas fa-laptop", accent: "#3b82f6", bg: "#eff6ff" },
    { name: "Gaming", icon: "fas fa-gamepad", accent: "#8b5cf6", bg: "#f5f3ff" },
    { name: "Audio", icon: "fas fa-headphones", accent: "#10b981", bg: "#ecfdf5" },
    { name: "Photography", icon: "fas fa-camera", accent: "#f59e0b", bg: "#fffbeb" },
    { name: "Pet Shop", icon: "fas fa-paw", accent: "#f97316", bg: "#fff7ed" },
    { name: "Baby & Kids", icon: "fas fa-baby", accent: "#0ea5e9", bg: "#f0f9ff" },
    { name: "Beauty & Personal Care", icon: "fas fa-spa", accent: "#fb7185", bg: "#fff1f2" },
    { name: "Fashion & Accessories", icon: "fas fa-tshirt", accent: "#7c3aed", bg: "#f5f3ff" }
  ];
  const catCards = categories.map((c) => `
    <a href="/marketplace?cat=${encodeURIComponent(c.name)}" class="home-cat-card"
       style="--cat-accent:${c.accent};--cat-bg:${c.bg};"
       data-accent="${c.accent}">
      <div class="home-cat-icon" style="background:${c.bg};">
        <i class="${c.icon}" style="color:${c.accent};"></i>
      </div>
      <span class="home-cat-label">${c.name}</span>
      <i class="fas fa-arrow-right home-cat-arrow" style="color:${c.accent};"></i>
    </a>`).join("");
  return shell("Home", `

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       HERO \u2014 Premium dark with depth layers
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-hero">
    <!-- Noise texture overlay -->
    <div class="home-hero-noise"></div>
    <!-- Grid -->
    <div class="home-hero-grid"></div>
    <!-- Radial glow right -->
    <div class="home-hero-glow-r"></div>
    <!-- Radial glow left -->
    <div class="home-hero-glow-l"></div>
    <!-- Horizontal accent line -->
    <div class="home-hero-line"></div>

    <div class="home-hero-inner">
      <!-- LEFT column -->
      <div class="home-hero-left">

        <!-- Pill badge -->
        <div class="home-hero-pill">
          <span class="home-hero-dot"></span>
          <span>LIVE ON ARC NETWORK</span>
          <span class="home-hero-pill-sep">\xB7</span>
          <span>CHAIN ID 5042002</span>
        </div>

        <!-- Headline -->
        <h1 class="home-hero-h1">
          Shop the
          <span class="home-hero-gradient-text">Future</span>
          <br/>of Decentralized<br/>
          <span class="home-hero-muted">Commerce.</span>
        </h1>

        <!-- Sub-headline -->
        <p class="home-hero-sub">
          Buy and sell with confidence using <strong>USDC &amp; EURC</strong>.
          Every transaction is protected by smart contract escrow on Circle's
          stablecoin-native L1 blockchain.
        </p>

        <!-- CTA buttons -->
        <div class="home-hero-ctas">
          <a href="/marketplace" class="home-btn-primary">
            <i class="fas fa-store"></i> Browse Marketplace
          </a>
          <a href="/wallet" class="home-btn-ghost">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>

        <!-- Trust chips -->
        <div class="home-trust-chips">
          ${[
    ["fas fa-shield-alt", "#22c55e", "Non-Custodial"],
    ["fas fa-lock", "#60a5fa", "Zero Key Access"],
    ["fas fa-file-contract", "#a78bfa", "Open Contracts"],
    ["fas fa-receipt", "#fb7185", "On-Chain Receipts"]
  ].map(([icon, col, label]) => `
            <div class="home-trust-chip">
              <i class="${icon}" style="color:${col};"></i>
              <span>${label}</span>
            </div>`).join("")}
        </div>

        <!-- Network status -->
        <div id="home-network-status" class="home-network-status">
          <span class="home-network-dot"></span>Checking Arc Network\u2026
        </div>
      </div>

      <!-- RIGHT column \u2014 glass card -->
      <div class="home-hero-right">
        <!-- Floating green badge -->
        <div class="home-float-badge home-float-badge-top">
          <div class="home-float-badge-icon" style="background:#d1fae5;">
            <i class="fas fa-shield-alt" style="color:#059669;"></i>
          </div>
          <div>
            <p class="home-float-title">Escrow Protected</p>
            <p class="home-float-sub">Every transaction</p>
          </div>
        </div>

        <!-- Main glass card -->
        <div class="home-glass-card">
          <div class="home-glass-header">
            <div class="home-glass-logo">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".95"/></svg>
            </div>
            <div>
              <p class="home-glass-name">Shukly Store</p>
              <p class="home-glass-net">On Arc Network</p>
            </div>
            <div class="home-live-badge">
              <span class="home-live-dot"></span>
              <span>Live</span>
            </div>
          </div>

          <div class="home-glass-grid">
            ${[
    ["fas fa-coins", "USDC / EURC", "Native Stablecoin", "#fbbf24"],
    ["fas fa-shield-alt", "Escrow", "Smart Contract", "#60a5fa"],
    ["fas fa-network-wired", "Arc L1", "Chain 5042002", "#818cf8"],
    ["fas fa-lock", "Trustless", "Non-Custodial", "#4ade80"]
  ].map(([icon, title, sub, col]) => `
              <div class="home-glass-stat">
                <i class="${icon}" style="color:${col};font-size:15px;margin-bottom:8px;display:block;"></i>
                <p class="home-glass-stat-title">${title}</p>
                <p class="home-glass-stat-sub">${sub}</p>
              </div>`).join("")}
          </div>

          <a href="/sell" class="home-glass-cta">
            <i class="fas fa-plus-circle"></i> Start Selling \u2014 Earn USDC
          </a>
        </div>

        <!-- Floating yellow badge -->
        <div class="home-float-badge home-float-badge-bot">
          <div class="home-float-badge-icon" style="background:#fef3c7;">
            <i class="fas fa-bolt" style="color:#d97706;"></i>
          </div>
          <div>
            <p class="home-float-title">Instant Transfers</p>
            <p class="home-float-sub">USDC &amp; EURC</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Scroll cue -->
    <div class="home-scroll-cue">
      <span>Scroll</span>
      <i class="fas fa-chevron-down home-bounce"></i>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       TRUST BAR
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-trust-bar">
    <div class="home-trust-bar-inner">
      ${[
    ["fas fa-shield-alt", "#22c55e", "Escrow Protected", "Smart contract locked"],
    ["fas fa-coins", "#f59e0b", "USDC &amp; EURC", "Stablecoin payments only"],
    ["fas fa-network-wired", "#6366f1", "Arc Network", "Circle's L1 blockchain"],
    ["fas fa-lock", "#3b82f6", "Non-Custodial", "You own your keys"],
    ["fas fa-receipt", "#ec4899", "On-Chain Receipts", "Real tx hashes"],
    ["fas fa-file-contract", "#8b5cf6", "Smart Contracts", "Open source escrow"]
  ].map(([icon, col, title, sub]) => `
        <div class="home-trust-item">
          <div class="home-trust-icon" style="background:${col}18;">
            <i class="${icon}" style="color:${col};"></i>
          </div>
          <div>
            <p class="home-trust-title">${title}</p>
            <p class="home-trust-sub">${sub}</p>
          </div>
        </div>`).join("")}
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       CATEGORIES \u2014 Large premium cards
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-section">
    <div class="home-section-header">
      <div>
        <p class="home-section-eyebrow">EXPLORE</p>
        <h2 class="home-section-title">Browse Categories</h2>
      </div>
      <a href="/marketplace" class="home-view-all">
        View all <i class="fas fa-arrow-right" style="font-size:11px;"></i>
      </a>
    </div>
    <div class="home-cat-grid">
      ${catCards}
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       DEMO NOTICE
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <div class="home-demo-notice">
    <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0;font-size:15px;"></i>
    <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
  </div>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       FEATURED PRODUCTS
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-section home-section-products">
    <div class="home-section-header">
      <div>
        <p class="home-section-eyebrow">MARKETPLACE</p>
        <h2 class="home-section-title">Latest Products</h2>
      </div>
      <a href="/marketplace" class="home-view-all">
        View all <i class="fas fa-arrow-right" style="font-size:11px;"></i>
      </a>
    </div>
    <div id="home-products-container">
      <div class="home-loading">
        <div class="loading-spinner-lg"></div>
        <p>Loading products from Arc Network\u2026</p>
      </div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       HOW IT WORKS \u2014 Dark premium section
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-how">
    <div class="home-how-grid-bg"></div>
    <div class="home-how-inner">
      <div class="home-how-header">
        <p class="home-section-eyebrow" style="color:#ef4444;">PROCESS</p>
        <h2 class="home-section-title" style="color:#fff;">How Shukly Store Works</h2>
        <p style="color:#64748b;font-size:15px;max-width:520px;margin:0 auto;line-height:1.7;">
          A trustless escrow marketplace powered by Arc Network smart contracts.
          No intermediaries. No custodians. Just code.
        </p>
      </div>
      <div class="home-how-steps">
        ${[
    ["01", "fas fa-search", "#ef4444", "Find Products", "Browse real listings from verified sellers on Arc Network"],
    ["02", "fas fa-wallet", "#3b82f6", "Connect Wallet", "Use MetaMask or our internal wallet on Arc Testnet (Chain 5042002)"],
    ["03", "fas fa-lock", "#8b5cf6", "Escrow Lock", "USDC/EURC locked in smart contract \u2014 fully trustless and transparent"],
    ["04", "fas fa-check-circle", "#22c55e", "Confirm & Release", "Confirm delivery \u2192 funds automatically released on-chain"]
  ].map(([n, icon, col, title, desc]) => `
          <div class="home-how-step">
            <div class="home-how-step-num">${n}</div>
            <div class="home-how-step-icon" style="background:${col}22;border:1px solid ${col}33;">
              <i class="${icon}" style="color:${col};font-size:20px;"></i>
            </div>
            <h3 class="home-how-step-title">${title}</h3>
            <p class="home-how-step-desc">${desc}</p>
          </div>`).join("")}
      </div>
      <!-- Connector line (desktop) -->
      <div class="home-how-connector"></div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       ABOUT + TRUST SIGNALS \u2014 Two-column card
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="home-section home-about-section">
    <div class="home-about-card">

      <!-- Left: About text -->
      <div class="home-about-left">
        <div class="home-about-logo-row">
          <div class="home-about-logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".95"/></svg>
          </div>
          <h2 class="home-about-title">About Shukly Store</h2>
        </div>
        <p class="home-about-body">
          <strong>Shukly Store</strong> is a decentralized marketplace powered by
          <strong>Arc Network</strong> \u2014 Circle's stablecoin-native Layer 1 blockchain.
          It uses escrow smart contracts to protect every transaction: funds are locked
          on-chain until the buyer confirms delivery, then automatically released to the seller.
        </p>
        <p class="home-about-body">
          All payments are made exclusively in <strong>USDC</strong> (native on Arc) or
          <strong>EURC</strong> \u2014 no fiat, no credit cards, no custodians. The internal wallet
          is generated entirely client-side using BIP39 standards; private keys never leave
          your browser.
        </p>
        <div class="demo-disclaimer" style="margin-bottom:20px;">
          <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
          <span>This is an open-source <strong>testnet demo</strong>. No real funds involved. Smart contracts run on Arc Testnet (Chain ID: 5042002).</span>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <a href="/about" class="btn-secondary" style="font-size:13px;padding:9px 18px;"><i class="fas fa-info-circle"></i> Learn More</a>
          <a href="/terms" class="btn-secondary" style="font-size:13px;padding:9px 18px;"><i class="fas fa-file-alt"></i> Terms</a>
        </div>
      </div>

      <!-- Right: Trust signals -->
      <div class="home-about-right">
        <p class="home-about-signals-label">TRUST SIGNALS</p>
        <div class="home-about-signals">
          ${[
    ["fas fa-lock", "#22c55e", "Non-custodial wallet", "Your keys never leave your device"],
    ["fas fa-file-contract", "#3b82f6", "Open escrow contracts", "Fully auditable on-chain"],
    ["fab fa-github", "#1e293b", "Open-source", "Inspect the code on GitHub", "https://github.com/julenosinger/redhawk-store"],
    ["fas fa-network-wired", "#8b5cf6", "Arc Testnet", "Chain ID: 5042002"],
    ["fas fa-shield-alt", "#ef4444", "Zero key custody", "100% self-sovereign"],
    ["fas fa-coins", "#f59e0b", "USDC &amp; EURC", "Stablecoin native L1"]
  ].map(([icon, col, title, sub, link]) => `
            <div class="home-signal-item">
              <div class="home-signal-icon" style="background:${col}14;">
                <i class="${icon}" style="color:${col};font-size:14px;"></i>
              </div>
              <div>
                <p class="home-signal-title">${link ? `<a href="${link}" target="_blank" style="color:#3b82f6;text-decoration:none;">${title}</a>` : title}</p>
                <p class="home-signal-sub">${sub}</p>
              </div>
            </div>`).join("")}
        </div>
      </div>

    </div>
  </section>

  ${footer()}

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
       HOME PAGE STYLES
  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <style>
  /* \u2500\u2500\u2500 Animations \u2500\u2500\u2500 */
  @keyframes home-bounce {
    0%,100%{transform:translateY(0) translateX(-50%)}
    50%{transform:translateY(7px) translateX(-50%)}
  }
  @keyframes home-pulse {
    0%,100%{opacity:1;transform:scale(1)}
    50%{opacity:.5;transform:scale(.85)}
  }
  @keyframes home-float {
    0%,100%{transform:translateY(0)}
    50%{transform:translateY(-8px)}
  }
  @keyframes home-shimmer {
    0%{background-position:-400px 0}
    100%{background-position:400px 0}
  }

  /* \u2500\u2500\u2500 Hero \u2500\u2500\u2500 */
  .home-hero {
    position:relative;overflow:hidden;
    background:linear-gradient(145deg,#080c14 0%,#0d1425 30%,#130d2e 60%,#1a0808 100%);
    min-height:100vh;display:flex;align-items:center;
  }
  .home-hero-noise {
    position:absolute;inset:0;pointer-events:none;opacity:.025;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E");
  }
  .home-hero-grid {
    position:absolute;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(220,38,38,.06) 1px,transparent 1px),
      linear-gradient(90deg,rgba(220,38,38,.06) 1px,transparent 1px);
    background-size:72px 72px;
    mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,black 40%,transparent 100%);
  }
  .home-hero-glow-r {
    position:absolute;top:-200px;right:-150px;width:700px;height:700px;border-radius:50%;
    background:radial-gradient(circle,rgba(220,38,38,.18) 0%,transparent 65%);
    pointer-events:none;
  }
  .home-hero-glow-l {
    position:absolute;bottom:-150px;left:-100px;width:550px;height:550px;border-radius:50%;
    background:radial-gradient(circle,rgba(99,102,241,.14) 0%,transparent 65%);
    pointer-events:none;
  }
  .home-hero-line {
    position:absolute;bottom:0;left:0;right:0;height:1px;
    background:linear-gradient(90deg,transparent,rgba(220,38,38,.25),rgba(99,102,241,.2),transparent);
  }
  .home-hero-inner {
    max-width:1320px;margin:0 auto;padding:100px 32px 120px;
    width:100%;position:relative;z-index:1;
    display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center;
  }
  @media(max-width:960px){
    .home-hero-inner{grid-template-columns:1fr;gap:48px;padding:80px 20px 100px;}
    .home-hero-right{display:none;}
  }

  /* Pill */
  .home-hero-pill {
    display:inline-flex;align-items:center;gap:8px;
    background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.25);
    color:#fca5a5;padding:6px 16px;border-radius:999px;
    font-size:11px;font-weight:700;margin-bottom:32px;
    letter-spacing:.06em;backdrop-filter:blur(4px);
  }
  .home-hero-dot {
    width:7px;height:7px;border-radius:50%;background:#ef4444;
    display:inline-block;animation:home-pulse 2s infinite;flex-shrink:0;
  }
  .home-hero-pill-sep{opacity:.4;}

  /* H1 */
  .home-hero-h1 {
    font-size:clamp(2.8rem,5.5vw,4.4rem);font-weight:900;color:#fff;
    line-height:1.05;letter-spacing:-.035em;margin-bottom:28px;
  }
  .home-hero-gradient-text {
    background:linear-gradient(135deg,#ef4444 0%,#f97316 50%,#fbbf24 100%);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  }
  .home-hero-muted{color:#475569;}

  /* Sub */
  .home-hero-sub {
    font-size:1.1rem;color:#64748b;line-height:1.75;
    max-width:500px;margin-bottom:40px;
  }
  .home-hero-sub strong{color:#cbd5e1;font-weight:600;}

  /* CTAs */
  .home-hero-ctas{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:40px;}
  .home-btn-primary {
    display:inline-flex;align-items:center;gap:9px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:15px 30px;border-radius:14px;font-weight:700;font-size:15px;
    text-decoration:none;box-shadow:0 4px 24px rgba(220,38,38,.45);
    transition:all .25s;letter-spacing:.01em;
  }
  .home-btn-primary:hover{transform:translateY(-3px);box-shadow:0 10px 36px rgba(220,38,38,.55);}
  .home-btn-ghost {
    display:inline-flex;align-items:center;gap:9px;
    background:rgba(255,255,255,.06);color:#cbd5e1;
    padding:15px 30px;border-radius:14px;font-weight:600;font-size:15px;
    text-decoration:none;border:1px solid rgba(255,255,255,.1);
    backdrop-filter:blur(12px);transition:all .25s;
  }
  .home-btn-ghost:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff;}

  /* Trust chips */
  .home-trust-chips{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px;}
  .home-trust-chip {
    display:inline-flex;align-items:center;gap:7px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    padding:6px 14px;border-radius:999px;font-size:12px;color:#94a3b8;
    font-weight:500;backdrop-filter:blur(4px);
  }
  .home-trust-chip i{font-size:12px;}

  /* Network status */
  .home-network-status{font-size:12px;color:#334155;display:flex;align-items:center;gap:8px;}
  .home-network-dot{width:8px;height:8px;border-radius:50%;background:#334155;display:inline-block;flex-shrink:0;}

  /* Glass card */
  .home-glass-card {
    background:rgba(255,255,255,.04);backdrop-filter:blur(24px);
    border:1px solid rgba(255,255,255,.09);border-radius:28px;
    padding:32px;width:100%;max-width:400px;
    box-shadow:0 40px 80px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07);
    animation:home-float 6s ease-in-out infinite;
  }
  .home-glass-header{display:flex;align-items:center;gap:12px;margin-bottom:24px;}
  .home-glass-logo {
    width:42px;height:42px;border-radius:13px;flex-shrink:0;
    background:linear-gradient(135deg,#dc2626,#7c3aed);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 14px rgba(220,38,38,.35);
  }
  .home-glass-name{font-weight:700;color:#f8fafc;font-size:14px;margin:0;}
  .home-glass-net{font-size:11px;color:#475569;margin:0;}
  .home-live-badge {
    margin-left:auto;display:flex;align-items:center;gap:6px;
    background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);
    padding:4px 11px;border-radius:999px;font-size:11px;color:#4ade80;font-weight:600;
  }
  .home-live-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;animation:home-pulse 2s infinite;}
  .home-glass-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
  .home-glass-stat {
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);
    border-radius:14px;padding:16px;
  }
  .home-glass-stat-title{font-weight:700;color:#f1f5f9;font-size:13px;margin:0 0 3px;}
  .home-glass-stat-sub{font-size:11px;color:#475569;margin:0;}
  .home-glass-cta {
    display:flex;align-items:center;justify-content:center;gap:8px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:13px;border-radius:14px;font-weight:600;font-size:13px;
    text-decoration:none;width:100%;box-sizing:border-box;
    box-shadow:0 4px 16px rgba(220,38,38,.4);transition:all .2s;
  }
  .home-glass-cta:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(220,38,38,.5);}

  /* Hero right column */
  .home-hero-right{display:flex;justify-content:center;align-items:center;position:relative;}

  /* Floating badges */
  .home-float-badge {
    position:absolute;background:#fff;border-radius:16px;padding:12px 16px;
    box-shadow:0 12px 32px rgba(0,0,0,.18);
    display:flex;align-items:center;gap:10px;
    animation:home-float 5s ease-in-out infinite;
    z-index:2;
  }
  .home-float-badge-top{top:-20px;right:-16px;animation-delay:.5s;}
  .home-float-badge-bot{bottom:-18px;left:-16px;animation-delay:1.2s;}
  .home-float-badge-icon{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .home-float-title{font-size:12px;font-weight:700;color:#1e293b;margin:0;}
  .home-float-sub{font-size:11px;color:#64748b;margin:0;}

  /* Scroll cue */
  .home-scroll-cue {
    position:absolute;bottom:32px;left:50%;transform:translateX(-50%);
    display:flex;flex-direction:column;align-items:center;gap:6px;opacity:.3;
    font-size:10px;color:#94a3b8;letter-spacing:.1em;text-transform:uppercase;
    animation:home-bounce 2s ease-in-out infinite;
  }
  .home-bounce{font-size:13px;}

  /* \u2500\u2500\u2500 Trust bar \u2500\u2500\u2500 */
  .home-trust-bar{background:#fff;border-bottom:1px solid #f0f4f8;}
  .home-trust-bar-inner {
    max-width:1320px;margin:0 auto;padding:0 16px;
    display:flex;flex-wrap:nowrap;justify-content:center;
    overflow:hidden;
  }
  .home-trust-item {
    display:flex;align-items:center;gap:10px;
    padding:16px 18px;border-right:1px solid #f0f4f8;
    flex:1 1 0;min-width:0;
    transition:background .2s;
  }
  .home-trust-item:hover{background:#fafbfc;}
  .home-trust-icon{width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;}
  .home-trust-title{font-weight:700;color:#1e293b;font-size:12px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
  .home-trust-sub{color:#94a3b8;font-size:10px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}

  /* \u2500\u2500\u2500 Demo notice \u2500\u2500\u2500 */
  .home-demo-notice {
    max-width:1320px;margin:40px auto 0;padding:0 24px;
    background:#fffbeb;border:1px solid #fde68a;border-radius:14px;
    padding:14px 20px;font-size:13px;color:#92400e;
    display:flex;align-items:flex-start;gap:12px;line-height:1.5;
    max-width:calc(1320px - 48px);margin:40px auto 0;
  }

  /* \u2500\u2500\u2500 Section layout \u2500\u2500\u2500 */
  .home-section{max-width:1320px;margin:0 auto;padding:80px 24px;}
  .home-section-products{padding-bottom:100px;}
  .home-section-header {
    display:flex;align-items:flex-end;justify-content:space-between;
    margin-bottom:44px;gap:16px;flex-wrap:wrap;
  }
  .home-section-eyebrow{
    font-size:11px;font-weight:800;color:#ef4444;
    text-transform:uppercase;letter-spacing:.12em;margin-bottom:8px;
  }
  .home-section-title{
    font-size:clamp(1.7rem,3vw,2.2rem);font-weight:900;
    color:#0f172a;letter-spacing:-.025em;margin:0;line-height:1.15;
  }
  .home-view-all {
    display:inline-flex;align-items:center;gap:7px;color:#ef4444;
    font-size:13px;font-weight:700;text-decoration:none;
    border:1.5px solid #fecaca;padding:9px 20px;border-radius:12px;
    transition:all .2s;white-space:nowrap;flex-shrink:0;
  }
  .home-view-all:hover{background:#fef2f2;border-color:#ef4444;}

  /* \u2500\u2500\u2500 Category cards \u2500\u2500\u2500 */
  .home-cat-grid{
    display:grid;
    grid-template-columns:repeat(auto-fill,minmax(140px,1fr));
    gap:16px;
  }
  @media(max-width:600px){.home-cat-grid{grid-template-columns:repeat(2,1fr);}}
  .home-cat-card {
    background:#fff;border-radius:20px;border:1.5px solid #f0f4f8;
    padding:24px 16px 20px;
    display:flex;flex-direction:column;align-items:center;gap:14px;
    text-decoration:none;transition:all .28s cubic-bezier(.34,1.56,.64,1);
    cursor:pointer;text-align:center;
    box-shadow:0 1px 4px rgba(0,0,0,.04);
    position:relative;overflow:hidden;
  }
  .home-cat-card::before {
    content:'';position:absolute;inset:0;opacity:0;
    background:linear-gradient(135deg,var(--cat-bg),transparent);
    transition:opacity .28s;
  }
  .home-cat-card:hover{
    transform:translateY(-6px) scale(1.02);
    box-shadow:0 20px 44px rgba(0,0,0,.1);
    border-color:var(--cat-accent,#ef4444);
  }
  .home-cat-card:hover::before{opacity:1;}
  .home-cat-icon {
    width:60px;height:60px;border-radius:18px;
    display:flex;align-items:center;justify-content:center;
    font-size:24px;transition:transform .28s;
    flex-shrink:0;position:relative;z-index:1;
  }
  .home-cat-card:hover .home-cat-icon{transform:scale(1.1) rotate(-4deg);}
  .home-cat-label {
    font-weight:700;color:#1e293b;font-size:12px;line-height:1.35;
    position:relative;z-index:1;
  }
  .home-cat-arrow{
    font-size:10px;opacity:0;transform:translateX(-4px);
    transition:all .2s;position:relative;z-index:1;
  }
  .home-cat-card:hover .home-cat-arrow{opacity:1;transform:translateX(0);}

  /* \u2500\u2500\u2500 Loading state \u2500\u2500\u2500 */
  .home-loading{text-align:center;padding:72px 0;}
  .home-loading .loading-spinner-lg{margin:0 auto 20px;}
  .home-loading p{color:#94a3b8;font-size:14px;}

  /* \u2500\u2500\u2500 How it Works \u2500\u2500\u2500 */
  .home-how {
    background:linear-gradient(155deg,#080c14 0%,#0e1425 40%,#160a28 70%,#1a0808 100%);
    padding:112px 24px;position:relative;overflow:hidden;
  }
  .home-how-grid-bg{
    position:absolute;inset:0;pointer-events:none;
    background-image:
      linear-gradient(rgba(220,38,38,.04) 1px,transparent 1px),
      linear-gradient(90deg,rgba(220,38,38,.04) 1px,transparent 1px);
    background-size:56px 56px;
    mask-image:radial-gradient(ellipse 90% 80% at 50% 50%,black 30%,transparent 100%);
  }
  .home-how-inner{max-width:1320px;margin:0 auto;position:relative;z-index:1;}
  .home-how-header{text-align:center;margin-bottom:72px;}
  .home-how-header p:first-child{margin-bottom:12px;}
  .home-how-steps{
    display:grid;grid-template-columns:repeat(4,1fr);gap:40px;
    position:relative;
  }
  @media(max-width:900px){.home-how-steps{grid-template-columns:repeat(2,1fr);}}
  @media(max-width:500px){.home-how-steps{grid-template-columns:1fr;gap:32px;}}
  .home-how-step{position:relative;padding-top:8px;}
  .home-how-step-num{
    font-size:10px;font-weight:800;letter-spacing:.14em;
    color:rgba(220,38,38,.35);margin-bottom:20px;
  }
  .home-how-step-icon{
    width:60px;height:60px;border-radius:20px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:20px;
    box-shadow:0 8px 24px rgba(0,0,0,.25);
    transition:transform .2s;
  }
  .home-how-step:hover .home-how-step-icon{transform:translateY(-4px);}
  .home-how-step-title{font-weight:800;color:#f1f5f9;font-size:16px;margin:0 0 10px;}
  .home-how-step-desc{color:#475569;font-size:13px;line-height:1.7;margin:0;}
  .home-how-connector{
    display:none;
    position:absolute;top:62px;left:calc(12.5% + 30px);right:calc(12.5% + 30px);
    height:1px;background:linear-gradient(90deg,#dc2626,#7c3aed,#22c55e);
    opacity:.25;pointer-events:none;
  }
  @media(min-width:901px){.home-how-connector{display:block;}}

  /* \u2500\u2500\u2500 About section \u2500\u2500\u2500 */
  .home-about-section{padding-bottom:100px;}
  .home-about-card{
    background:#fff;border-radius:28px;border:1px solid #f0f4f8;
    box-shadow:0 6px 32px rgba(0,0,0,.06);overflow:hidden;
    display:grid;grid-template-columns:1fr 320px;
  }
  @media(max-width:800px){.home-about-card{grid-template-columns:1fr;}}
  .home-about-left{padding:56px;border-right:1px solid #f0f4f8;}
  @media(max-width:800px){.home-about-left{padding:36px;border-right:none;border-bottom:1px solid #f0f4f8;}}
  .home-about-right{padding:48px 40px;background:#fafbfc;}
  @media(max-width:800px){.home-about-right{padding:36px;}}
  .home-about-logo-row{display:flex;align-items:center;gap:14px;margin-bottom:24px;}
  .home-about-logo-icon{
    width:46px;height:46px;border-radius:15px;flex-shrink:0;
    background:linear-gradient(135deg,#dc2626,#7c3aed);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 6px 16px rgba(220,38,38,.3);
  }
  .home-about-title{font-size:1.5rem;font-weight:900;color:#0f172a;margin:0;letter-spacing:-.02em;}
  .home-about-body{color:#475569;font-size:14px;line-height:1.85;margin-bottom:16px;}
  .home-about-body strong{color:#1e293b;font-weight:700;}
  .home-about-signals-label{font-size:11px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:24px;}
  .home-about-signals{display:flex;flex-direction:column;gap:18px;}
  .home-signal-item{display:flex;align-items:center;gap:12px;}
  .home-signal-icon{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .home-signal-title{font-weight:700;color:#1e293b;font-size:13px;margin:0;}
  .home-signal-sub{color:#94a3b8;font-size:11px;margin:0;}

  /* \u2500\u2500\u2500 Product cards (home) \u2500\u2500\u2500 */
  .home-product-card {
    background:#fff;border-radius:22px;border:1.5px solid #f0f4f8;
    overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.05);
    transition:all .3s cubic-bezier(.34,1.56,.64,1);cursor:pointer;
  }
  .home-product-card:hover{
    transform:translateY(-8px);
    box-shadow:0 24px 56px rgba(0,0,0,.13);
    border-color:#fecaca;
  }
  .home-product-img{position:relative;overflow:hidden;}
  .home-product-img img,.home-product-img .home-product-placeholder{
    width:100%;height:220px;object-fit:cover;display:block;
    transition:transform .4s ease;
  }
  .home-product-card:hover .home-product-img img{transform:scale(1.05);}
  .home-product-placeholder{
    background:linear-gradient(135deg,#f8fafc,#e2e8f0);
    display:flex;align-items:center;justify-content:center;
    color:#cbd5e1;font-size:44px;
  }
  .home-product-escrow-badge{
    position:absolute;top:12px;left:12px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);
    color:#fff;padding:4px 11px;border-radius:999px;
    font-size:11px;font-weight:700;
    display:flex;align-items:center;gap:5px;
    box-shadow:0 2px 8px rgba(220,38,38,.4);
  }
  .home-product-body{padding:22px;}
  .home-product-cat{
    display:inline-block;background:#fef2f2;color:#dc2626;
    padding:3px 11px;border-radius:8px;font-size:11px;font-weight:700;
    margin-bottom:10px;
  }
  .home-product-title{
    font-weight:700;color:#1e293b;font-size:15px;
    margin:0 0 14px;line-height:1.45;
    display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
  }
  .home-product-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;}
  .home-product-price{font-size:1.45rem;font-weight:900;color:#dc2626;margin:0;}
  .home-product-token{font-size:12px;font-weight:600;color:#94a3b8;margin-left:3px;}
  .home-shop-btn {
    display:inline-flex;align-items:center;gap:6px;
    background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;
    padding:10px 20px;border-radius:12px;font-weight:700;font-size:13px;
    text-decoration:none;white-space:nowrap;
    box-shadow:0 4px 12px rgba(220,38,38,.35);
    transition:all .2s;
  }
  .home-shop-btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(220,38,38,.45);}
  </style>

  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    /* Network status */
    await checkNetworkStatus(document.getElementById('home-network-status'));

    /* Products */
    try {
      const res  = await fetch('/api/products');
      const data = await res.json();
      const el   = document.getElementById('home-products-container');
      if (!data.products || data.products.length === 0) {
        el.innerHTML = \`
          <div style="background:#fff;border-radius:24px;border:1.5px solid #f0f4f8;padding:80px 24px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.05);">
            <div style="width:80px;height:80px;border-radius:24px;background:linear-gradient(135deg,#fef2f2,#fee2e2);display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:32px;color:#fca5a5;box-shadow:0 4px 20px rgba(220,38,38,.1);">
              <i class="fas fa-store"></i>
            </div>
            <h3 style="font-size:1.3rem;font-weight:900;color:#1e293b;margin:0 0 10px;letter-spacing:-.01em;">No Products Listed Yet</h3>
            <p style="color:#94a3b8;font-size:14px;max-width:380px;margin:0 auto 32px;line-height:1.7;">Be the first seller \u2014 list your product and start earning USDC or EURC through smart contract escrow.</p>
            <a href="/sell" class="btn-primary" style="display:inline-flex;margin:0 auto;">
              <i class="fas fa-plus-circle"></i> List the First Product
            </a>
          </div>\`;
      } else {
        const latest = data.products.slice(0, 4);
        el.innerHTML =
          '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:28px;">'
          + latest.map(renderHomeProductCard).join('')
          + '</div>'
          + (data.products.length > 4
              ? \`<div style="text-align:center;margin-top:40px;"><a href="/marketplace" class="btn-secondary">View all \${data.products.length} products &nbsp;<i class="fas fa-arrow-right"></i></a></div>\`
              : '');
        // Lazy-load images after rendering cards
        lazyLoadHomeImages(latest);
      }
    } catch (e) {
      document.getElementById('home-products-container').innerHTML =
        '<div style="text-align:center;padding:56px 24px;color:#ef4444;">'
        +'<i class="fas fa-exclamation-circle" style="font-size:36px;margin-bottom:16px;display:block;opacity:.6;"></i>'
        +'<p style="font-size:14px;color:#64748b;">Failed to load products. Check your connection.</p></div>';
    }
  });

  function renderHomeProductCard(p) {
    const name  = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const price = parseFloat(p.price || 0).toFixed(2);
    const tok   = p.token || 'USDC';
    const cat   = p.category || 'Other';
    // Image is NOT included in list response; lazy-load via /api/products/:id
    const imgEl = p.image
      ? '<img src="' + p.image + '" alt="' + name + '">'
      : '<div class="home-product-placeholder" id="img-' + p.id + '"><div class="loading-spinner" style="width:28px;height:28px;border-width:3px;"></div></div>';
    return \`
      <div class="home-product-card" onclick="location.href='/product/\${p.id}'">
        <div class="home-product-img">
          \${imgEl}
          <div class="home-product-escrow-badge"><i class="fas fa-shield-alt"></i> Escrow</div>
        </div>
        <div class="home-product-body">
          <div class="home-product-cat">\${cat}</div>
          <h3 class="home-product-title">\${name}</h3>
          <div class="home-product-footer">
            <p class="home-product-price">\${price}<span class="home-product-token">\${tok}</span></p>
            <a href="/product/\${p.id}" class="home-shop-btn" onclick="event.stopPropagation()">
              <i class="fas fa-bolt"></i> Shop Now
            </a>
          </div>
        </div>
      </div>\`;
  }

  // Lazy-load images for home cards after initial render (single batch request)
  async function lazyLoadHomeImages(products) {
    if (!products.length) return;
    try {
      const ids = products.map(p => p.id).join(',');
      const res = await fetch('/api/products/images?ids=' + ids);
      const data = await res.json();
      const images = data.images || {};
      products.forEach(p => {
        const container = document.getElementById('img-' + p.id);
        if (!container) return;
        if (images[p.id]) {
          const img = document.createElement('img');
          img.src = images[p.id];
          img.alt = p.title || 'Product';
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit;';
          container.innerHTML = '';
          container.appendChild(img);
        } else {
          container.innerHTML = '<i class="fas fa-image"></i>';
        }
      });
    } catch {
      // silently fail \u2014 placeholders stay
    }
  }
  </script>
  `);
}
function marketplacePage() {
  return shell("Marketplace", `
  <div class="max-w-7xl mx-auto px-4 py-8">
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-800">Marketplace</h1>
        <p class="text-slate-500 mt-1">Live product listings \xB7 Payments via escrow on Arc Network</p>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <input id="mp-search-bar" type="text" placeholder="Search products\u2026" class="input text-sm py-2 w-48"/>
        <select id="mp-sort" class="select w-44 text-sm">
          <option value="newest">Sort: Newest</option>
          <option value="price_asc">Price: Low \u2192 High</option>
          <option value="price_desc">Price: High \u2192 Low</option>
        </select>
        <a href="/sell" class="btn-primary text-sm py-2">
          <i class="fas fa-plus-circle"></i> List Product
        </a>
      </div>
    </div>

    <!-- Network status bar -->
    <div id="mp-network-status" class="mb-4"></div>

    <!-- Demo Disclaimer \u2014 Marketplace -->
    <div class="demo-disclaimer mb-6">
      <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0"></i>
      <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
    </div>

    <div class="flex gap-8">
      <!-- Filters sidebar -->
      <aside class="hidden lg:block w-64 shrink-0">
        <div class="card p-5 sticky top-20">
          <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
            <i class="fas fa-sliders-h text-red-500"></i> Filters
          </h3>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Category</p>
            <div class="space-y-1.5">
              ${["All", "Electronics", "Gaming", "Audio", "Photography", "Wearables", "Accessories", "Pet Shop", "Baby & Kids", "Beauty & Personal Care", "Fashion & Accessories"].map((cat, i) => `
                <label class="flex items-center gap-2 cursor-pointer hover:text-red-600 text-sm text-slate-600">
                  <input type="checkbox" data-cat="${cat}" ${i === 0 ? "checked" : ""} class="cat-filter accent-red-600 w-3.5 h-3.5"/> ${cat}
                </label>`).join("")}
            </div>
          </div>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Price Range</p>
            <div class="flex gap-2">
              <input type="number" placeholder="Min" class="input text-xs py-1.5"/>
              <input type="number" placeholder="Max" class="input text-xs py-1.5"/>
            </div>
          </div>
          <div class="mb-5">
            <p class="font-semibold text-slate-700 text-sm mb-2">Token</p>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600 mb-1"><input type="checkbox" checked class="accent-red-600"/> USDC</label>
            <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600"><input type="checkbox" checked class="accent-red-600"/> EURC</label>
          </div>
          <button onclick="renderProducts()" class="btn-primary w-full text-sm justify-center">Apply Filters</button>
        </div>
      </aside>

      <!-- Products grid -->
      <div class="flex-1" id="mp-products-container">
        <div class="text-center py-12">
          <div class="loading-spinner-lg mx-auto mb-4"></div>
          <p class="text-slate-400">Fetching products from Arc Network\u2026</p>
        </div>
      </div>
    </div>
  </div>

  <script>
  // \u2500\u2500 State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  let allProducts = [];
  let activeCategory = 'All';
  let sortMode = 'newest';

  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('mp-network-status'));

    // Read ?cat= param from URL
    const urlCat = new URLSearchParams(window.location.search).get('cat') || 'All';
    activeCategory = urlCat;

    // Update sidebar checkbox
    document.querySelectorAll('.cat-filter').forEach(cb => {
      cb.checked = (cb.dataset.cat === activeCategory || (activeCategory === 'All' && cb.dataset.cat === 'All'));
      cb.addEventListener('change', () => {
        activeCategory = cb.dataset.cat;
        document.querySelectorAll('.cat-filter').forEach(x => { x.checked = x.dataset.cat === activeCategory; });
        renderProducts();
      });
    });

    document.getElementById('mp-sort').addEventListener('change', function() {
      sortMode = this.value; renderProducts();
    });
    document.getElementById('mp-search-bar').addEventListener('input', function() {
      renderProducts(this.value.trim().toLowerCase());
    });

    await loadProducts();
  });

  async function loadProducts() {
    try {
      const res  = await fetch('/api/products');
      const data = await res.json();
      allProducts = data.products || [];
      renderProducts();
    } catch {
      document.getElementById('mp-products-container').innerHTML =
        '<div class="card p-8 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Could not connect to marketplace. Please try again.</div>';
    }
  }

  function renderProducts(searchText) {
    const q = (searchText !== undefined ? searchText : (document.getElementById('mp-search-bar')||{}).value || '').toLowerCase();
    let list = allProducts.filter(p => {
      const matchCat = activeCategory === 'All' || p.category === activeCategory;
      const matchQ   = !q || (p.title||p.name||'').toLowerCase().includes(q) || (p.description||'').toLowerCase().includes(q);
      return matchCat && matchQ;
    });

    if (sortMode === 'price_asc')  list = [...list].sort((a,b) => a.price - b.price);
    if (sortMode === 'price_desc') list = [...list].sort((a,b) => b.price - a.price);
    if (sortMode === 'newest')     list = [...list].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

    const container = document.getElementById('mp-products-container');
    if (list.length === 0) {
      container.innerHTML = \`
        <div class="card p-16 text-center">
          <div class="empty-state">
            <i class="fas fa-store"></i>
            <h3 class="font-bold text-slate-700 text-xl mb-2">\${allProducts.length === 0 ? 'No Products Listed Yet' : 'No Products Found'}</h3>
            <p class="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
              \${allProducts.length === 0
                ? 'Be the first seller to list your product and earn USDC or EURC!'
                : 'Try changing the filters or search term.'}
            </p>
            <a href="/sell" class="btn-primary mx-auto text-base px-8 py-3">
              <i class="fas fa-plus-circle"></i> List a Product
            </a>
          </div>
        </div>\`;
    } else {
      container.innerHTML = '<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">'
        + list.map(p => renderMPCard(p)).join('') + '</div>'
        + \`<p class="text-xs text-slate-400 text-right mt-3">\${list.length} product\${list.length!==1?'s':''} found</p>\`;
      // Lazy-load images after rendering
      lazyLoadMPImages(list);
    }
  }

  function renderMPCard(p) {
    const price = parseFloat(p.price||0).toFixed(2);
    const title = (p.title || p.name || 'Untitled').replace(/</g,'&lt;');
    const desc  = (p.description||'').replace(/</g,'&lt;').slice(0,80);
    const cat   = (p.category||'Other').replace(/</g,'&lt;');
    const tok   = p.token || 'USDC';
    // Images are not included in list response; show spinner placeholder
    const imgEl = p.image
      ? '<img src="' + p.image + '" class="w-full h-48 object-cover" onerror="this.style.display=&quot;none&quot;;this.nextElementSibling.style.display=&quot;flex&quot;">'
        + '<div class="w-full h-48 bg-slate-100 items-center justify-center text-slate-300 hidden"><i class="fas fa-image text-4xl"></i></div>'
      : '<div class="w-full h-48 bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center" id="mpimg-' + p.id + '"><div class="loading-spinner" style="width:28px;height:28px;border-width:3px;"></div></div>';
    const sellerShort = p.seller_id ? (p.seller_id.slice(0,6)+'\u2026'+p.seller_id.slice(-4)) : '\u2014';
    return '<div class="product-card">'
      + '<div class="relative overflow-hidden">' + imgEl
      + '<span class="absolute top-2 left-2 badge-escrow"><i class="fas fa-shield-alt mr-1"></i>Escrow</span>'
      + '</div>'
      + '<div class="p-4">'
      + '<div class="flex items-center justify-between mb-1">'
      + '<span class="tag">' + cat + '</span>'
      + '<span class="text-xs text-slate-400 font-mono">' + sellerShort + '</span>'
      + '</div>'
      + '<h3 class="font-semibold text-slate-800 mt-2 mb-1 text-sm leading-tight">' + title + '</h3>'
      + (desc ? '<p class="text-xs text-slate-400 mb-2 leading-relaxed">' + desc + (p.description.length>80?'\u2026':'') + '</p>' : '')
      + '<p class="text-xl font-extrabold text-red-600 mb-3">' + price + ' <span class="text-sm font-semibold">' + tok + '</span></p>'
      + '<div class="flex gap-2">'
      + '<a href="/product/' + p.id + '" class="btn-primary flex-1 text-xs py-2 justify-center"><i class="fas fa-bolt mr-1"></i>Buy Now</a>'
      + '<a href="/product/' + p.id + '" class="btn-secondary text-xs py-2 px-3 justify-center"><i class="fas fa-eye"></i></a>'
      + '</div></div></div>';
  }

  // Lazy-load images for marketplace cards: single batch request for all visible products
  async function lazyLoadMPImages(products) {
    if (!products.length) return;
    try {
      const ids = products.map(p => p.id).join(',');
      const res = await fetch('/api/products/images?ids=' + ids);
      const data = await res.json();
      const images = data.images || {};
      products.forEach(p => {
        const container = document.getElementById('mpimg-' + p.id);
        if (!container) return;
        if (images[p.id]) {
          container.style.padding = '0';
          container.innerHTML = '<img src="' + images[p.id] + '" class="w-full h-48 object-cover" alt="' + (p.title||'').replace(/"/g,'') + '">';
        } else {
          container.innerHTML = '<span class="text-slate-300"><i class="fas fa-image text-4xl"></i></span>';
        }
      });
    } catch {
      // silently fail \u2014 placeholders stay
    }
  }
  </script>
  `);
}
function productNotFoundPage(id) {
  return shell("Product", `
  <!-- Demo Disclaimer \u2014 Product Page -->
  <div class="max-w-3xl mx-auto px-4 pt-6">
    <div class="demo-disclaimer">
      <i class="fas fa-info-circle" style="color:#d97706;flex-shrink:0"></i>
      <span><strong>Demonstration only:</strong> This marketplace is for demonstration purposes only. All products listed are illustrative and not real.</span>
    </div>
  </div>
  <div class="max-w-3xl mx-auto px-4 py-8 text-center">
    <div class="card p-12">
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <h2 class="text-2xl font-bold text-slate-700 mb-2">Product Not Found</h2>
        <p class="text-slate-400 mb-2">Product ID: <code class="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">${id}</code></p>
        <p class="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
          This product doesn't exist or hasn't been listed on Arc Network yet. All products must be verified on-chain.
        </p>
        <div class="flex flex-wrap gap-3 justify-center">
          <a href="/marketplace" class="btn-primary"><i class="fas fa-store"></i> Browse Marketplace</a>
          <a href="/sell" class="btn-secondary"><i class="fas fa-plus-circle"></i> List a Product</a>
        </div>
      </div>
    </div>
  </div>
  `);
}
function productPage(p) {
  const title = (p.title || "Untitled").replace(/</g, "&lt;");
  const desc = (p.description || "").replace(/</g, "&lt;");
  const price = parseFloat(p.price || 0).toFixed(2);
  const tok = p.token || "USDC";
  const cat = (p.category || "Other").replace(/</g, "&lt;");
  const seller = (p.seller_id || "").replace(/</g, "&lt;");
  const imgUrl = p.image || "";
  const stockN = parseInt(p.stock) || 0;
  const delivType = p.delivery_type || "manual";
  const isDigital = delivType === "instant" || delivType === "digital";
  return shell(title, `
  <style>
    /* \u2500\u2500 Product Page Premium Styles \u2500\u2500 */
    .pd-breadcrumb{display:flex;align-items:center;gap:6px;font-size:13px;color:#94a3b8;margin-bottom:28px;flex-wrap:wrap;position:sticky;top:60px;background:#fff;z-index:95;padding:12px 0;margin-left:-1rem;margin-right:-1rem;padding-left:1rem;padding-right:1rem;transform:translateY(0);opacity:1;transition:transform .3s,opacity .3s;will-change:transform}
    .pd-breadcrumb.hidden-scroll{transform:translateY(-100%);opacity:0;pointer-events:none}
    .pd-breadcrumb a{color:#64748b;text-decoration:none;font-weight:500;transition:color .15s}
    .pd-breadcrumb a:hover{color:#dc2626}
    .pd-breadcrumb .sep{color:#cbd5e1;font-size:10px}
    .pd-breadcrumb .current{color:#1e293b;font-weight:600}

    .pd-image-wrap{position:relative;border-radius:20px;overflow:hidden;background:#f8fafc;border:1px solid #f1f5f9;box-shadow:0 4px 24px rgba(0,0,0,.07)}
    .pd-image-wrap img{width:100%;max-height:500px;object-fit:cover;display:block;transition:transform .45s cubic-bezier(.25,.46,.45,.94)}
    .pd-image-wrap:hover img{transform:scale(1.04)}
    .pd-image-fallback{width:100%;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#cbd5e1;background:linear-gradient(135deg,#f8fafc,#f1f5f9)}
    .pd-image-fallback i{font-size:72px;opacity:.35}
    .pd-image-fallback span{font-size:13px;color:#94a3b8;font-weight:500}

    .pd-cat-badge{display:inline-flex;align-items:center;gap:5px;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
    .pd-delivery-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.3px}
    .pd-delivery-badge.instant{background:#ecfdf5;color:#059669;border:1px solid #6ee7b7}
    .pd-delivery-badge.manual{background:#fffbeb;color:#d97706;border:1px solid #fcd34d}

    .pd-price-block{display:flex;align-items:baseline;gap:8px;margin:10px 0 4px}
    .pd-price-main{font-size:2.6rem;font-weight:900;color:#dc2626;line-height:1;letter-spacing:-1px}
    .pd-price-tok{font-size:1.1rem;font-weight:700;color:#ef4444;opacity:.85}
    .pd-price-usd{font-size:13px;color:#94a3b8;font-weight:500;margin-left:4px}

    .pd-stock-badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:5px 12px;border-radius:20px}
    .pd-stock-badge.instock{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
    .pd-stock-badge.instock .dot{width:7px;height:7px;border-radius:50%;background:#16a34a;animation:pdpulse 1.8s ease-in-out infinite}
    .pd-stock-badge.outstock{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    @keyframes pdpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}

    .pd-escrow-box{background:linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%);border:1.5px solid #86efac;border-radius:16px;padding:18px 20px;position:relative;overflow:hidden}
    .pd-escrow-box::before{content:'';position:absolute;top:-20px;right:-20px;width:80px;height:80px;background:rgba(22,163,74,.08);border-radius:50%}
    .pd-escrow-title{font-size:13px;font-weight:800;color:#15803d;display:flex;align-items:center;gap:7px;margin-bottom:10px;letter-spacing:.2px}
    .pd-escrow-item{display:flex;align-items:center;gap:8px;font-size:12px;color:#166534;font-weight:500;margin-bottom:6px}
    .pd-escrow-item:last-child{margin-bottom:0}
    .pd-escrow-check{width:18px;height:18px;border-radius:50%;background:#16a34a;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px}

    .pd-keys-box{display:flex;align-items:center;gap:10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:12px 16px;font-size:12px;color:#1d4ed8;font-weight:500;position:relative}
    .pd-keys-box .pd-tooltip-wrap{position:relative;display:inline-flex;cursor:help;margin-left:auto}
    .pd-keys-box .pd-tooltip-wrap i{color:#93c5fd;font-size:13px}
    .pd-keys-box .pd-tooltip{display:none;position:absolute;right:0;bottom:calc(100% + 8px);background:#1e293b;color:#fff;font-size:11px;font-weight:400;padding:7px 10px;border-radius:8px;white-space:nowrap;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,.2)}
    .pd-keys-box .pd-tooltip-wrap:hover .pd-tooltip{display:block}

    .pd-section-label{font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px}
    .pd-section-label::after{content:'';flex:1;height:1px;background:#f1f5f9}

    .pd-desc-text{font-size:14px;color:#475569;line-height:1.75;white-space:pre-line}

    .pd-details-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .pd-detail-item{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:12px 14px}
    .pd-detail-item .label{font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}
    .pd-detail-item .value{font-size:13px;font-weight:600;color:#334155;display:flex;align-items:center;gap:5px}

    .pd-seller-box{background:#f8fafc;border:1px solid #f1f5f9;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px}
    .pd-seller-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0}
    .pd-seller-info{flex:1;min-width:0}
    .pd-seller-info .name{font-size:12px;font-weight:700;color:#1e293b;margin-bottom:2px}
    .pd-seller-info .addr{font-size:11px;font-family:monospace;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pd-copy-btn{flex-shrink:0;width:30px;height:30px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;transition:all .15s}
    .pd-copy-btn:hover{background:#fef2f2;border-color:#fecaca;color:#dc2626}
    .pd-copy-btn.copied{background:#f0fdf4;border-color:#86efac;color:#16a34a}

    .pd-btn-buy{width:100%;padding:16px 24px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(220,38,38,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-buy::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-buy:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(220,38,38,.45)}
    .pd-btn-buy:active{transform:translateY(0);box-shadow:0 4px 12px rgba(220,38,38,.3)}
    .pd-btn-buy:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
    
    /* Escrow state-specific button styles */
    .pd-btn-waiting{width:100%;padding:16px 24px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 4px 12px rgba(100,116,139,.25);opacity:.7}
    
    .pd-btn-confirm{width:100%;padding:16px 24px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(22,163,74,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-confirm::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-confirm:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(22,163,74,.45)}
    .pd-btn-confirm:active{transform:translateY(0);box-shadow:0 4px 12px rgba(22,163,74,.3)}
    
    .pd-btn-completed{width:100%;padding:16px 24px;background:linear-gradient(135deg,#10b981,#059669);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 4px 12px rgba(16,185,129,.25);opacity:.75}
    
    .pd-btn-dispute{width:100%;padding:16px 24px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;letter-spacing:.3px;box-shadow:0 6px 20px rgba(245,158,11,.35);transition:all .25s;position:relative;overflow:hidden}
    .pd-btn-dispute::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.15),transparent);pointer-events:none}
    .pd-btn-dispute:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(245,158,11,.45)}
    .pd-btn-dispute:active{transform:translateY(0);box-shadow:0 4px 12px rgba(245,158,11,.3)}
    
    .pd-btn-cart{width:100%;padding:13px 24px;background:#fff;color:#dc2626;border:2px solid #dc2626;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s}
    .pd-btn-cart:hover{background:#fef2f2;box-shadow:0 4px 12px rgba(220,38,38,.12)}
    .pd-btn-cart:active{transform:scale(.99)}

    .pd-outofstock{background:linear-gradient(135deg,#f8fafc,#f1f5f9);border:2px dashed #e2e8f0;border-radius:14px;padding:24px;text-align:center;color:#94a3b8}

    .pd-seller-panel{background:linear-gradient(135deg,#fffbeb,#fef9c3);border:1.5px solid #fcd34d;border-radius:14px;padding:16px 20px}
    .pd-seller-panel .title{font-size:13px;font-weight:800;color:#92400e;display:flex;align-items:center;gap:7px;margin-bottom:6px}
    .pd-seller-panel p{font-size:12px;color:#78350f;line-height:1.5}

    /* Sticky buy bar \u2014 all screen sizes, scroll-triggered */
    .pd-sticky-bar{display:flex;position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #f1f5f9;box-shadow:0 -4px 24px rgba(0,0,0,.12);padding:12px 16px 16px;z-index:90;gap:10px;align-items:center;transform:translateY(110%);opacity:0;transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s ease,box-shadow .3s ease}
    .pd-sticky-bar.visible{transform:translateY(0);opacity:1;box-shadow:0 -6px 32px rgba(220,38,38,.13)}
    @media(min-width:640px){.pd-sticky-bar{padding:14px 24px 18px}}

    .pd-arc-badge{display:inline-flex;align-items:center;gap:5px;background:linear-gradient(135deg,#1e40af,#2563eb);color:#fff;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.3px}
  </style>

  <div class="max-w-5xl mx-auto px-4 pt-8 pb-28 lg:pb-10">

    <!-- Breadcrumb -->
    <nav class="pd-breadcrumb">
      <a href="/"><i class="fas fa-home"></i></a>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <a href="/marketplace">Marketplace</a>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <span class="pd-breadcrumb-cat">${cat}</span>
      <span class="sep"><i class="fas fa-chevron-right"></i></span>
      <span class="current">${title.length > 32 ? title.slice(0, 32) + "\u2026" : title}</span>
    </nav>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-start">

      <!-- \u2500\u2500 LEFT: Image + Description \u2500\u2500 -->
      <div>
        <div class="pd-image-wrap">
          ${imgUrl ? `<img src="${imgUrl}" alt="${title}"
                 onerror="this.style.display='none';document.getElementById('img-fallback').style.display='flex'">` : ""}
          <div id="img-fallback" style="${imgUrl ? "display:none" : "display:flex"}" class="pd-image-fallback">
            <i class="fas fa-image"></i>
            <span>No image available</span>
          </div>
        </div>

        <!-- Arc Network badge under image -->
        <div class="flex items-center gap-3 mt-4 px-1">
          <span class="pd-arc-badge"><i class="fas fa-network-wired"></i> Arc Network</span>
          <span class="text-xs text-slate-400">Chain ID 5042002 \xB7 Testnet</span>
          <a href="https://testnet.arcscan.app" target="_blank" class="ml-auto text-xs text-slate-400 hover:text-red-500 transition-colors">
            <i class="fas fa-external-link-alt"></i> Explorer
          </a>
        </div>

        <!-- Description (below image) -->
        <div style="margin-top:24px">
          <div class="pd-section-label"><i class="fas fa-align-left" style="color:#cbd5e1"></i> Description</div>
          <p class="pd-desc-text">${desc || '<span style="color:#94a3b8;font-style:italic">No description provided.</span>'}</p>
        </div>
      </div>

      <!-- \u2500\u2500 RIGHT: Details \u2500\u2500 -->
      <div class="flex flex-col gap-5">

        <!-- Header: category + badges -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="pd-cat-badge"><i class="fas fa-tag"></i> ${cat}</span>
          ${isDigital ? `<span class="pd-delivery-badge instant"><i class="fas fa-bolt"></i> Instant Delivery</span>` : `<span class="pd-delivery-badge manual"><i class="fas fa-clock"></i> Manual Delivery</span>`}
          ${stockN > 0 ? `<span class="pd-stock-badge instock"><span class="dot"></span> In stock (${stockN})</span>` : `<span class="pd-stock-badge outstock"><i class="fas fa-times-circle" style="font-size:9px"></i> Out of stock</span>`}
        </div>

        <!-- Title -->
        <div>
          <h1 style="font-size:clamp(1.5rem,3vw,2rem);font-weight:900;color:#0f172a;line-height:1.2;letter-spacing:-.5px;margin-bottom:12px">${title}</h1>

          <!-- Price -->
          <div class="pd-price-block">
            <span class="pd-price-main">${price}</span>
            <span class="pd-price-tok">${tok}</span>
          </div>
          <p style="font-size:11px;color:#94a3b8;margin-top:2px">
            <i class="fas fa-info-circle" style="margin-right:3px"></i>Paid via ${tok} on Arc Testnet
          </p>
        </div>

        <!-- Escrow Protection Box -->
        <div class="pd-escrow-box">
          <div class="pd-escrow-title">
            <div style="width:28px;height:28px;border-radius:8px;background:#16a34a;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <i class="fas fa-shield-alt" style="color:#fff;font-size:12px"></i>
            </div>
            Escrow Smart Contract Protection
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Funds locked in Arc Network smart contract
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Released only after you confirm delivery
          </div>
          <div class="pd-escrow-item">
            <span class="pd-escrow-check"><i class="fas fa-check"></i></span>
            Dispute resolution available if needed
          </div>
        </div>

        <!-- Private Keys notice -->
        <div class="pd-keys-box">
          <i class="fas fa-lock" style="color:#3b82f6;font-size:15px;flex-shrink:0"></i>
          <span>We <strong>never</strong> access your private keys \u2014 all transactions signed locally in your wallet.</span>
          <div class="pd-tooltip-wrap">
            <i class="fas fa-question-circle"></i>
            <div class="pd-tooltip">Non-custodial: only you control your funds.</div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div id="product-action-btns" class="flex flex-col gap-3 mt-1">
          ${stockN > 0 ? `<button id="btn-buy-now"
                onclick="pdBuyNow('${p.id}','${title.replace(/'/g, "\\'")}',${price},'${tok}','${imgUrl}')"
                class="pd-btn-buy">
                <i class="fas fa-bolt"></i>
                Buy Now &mdash; ${price} ${tok}
              </button>
              <button id="btn-add-cart"
                onclick="pdAddCart('${p.id}','${title.replace(/'/g, "\\'")}',${price},'${tok}','${imgUrl}')"
                class="pd-btn-cart">
                <i class="fas fa-cart-plus"></i> Add to Cart
              </button>
              <!-- Arc Commerce badge \u2014 non-destructive, lazy-loaded -->
              <div id="arc-pd-badge" style="display:none;align-items:center;gap:6px;font-size:11px;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:6px 10px;">
                <span style="background:#1e40af;color:#fff;padding:1px 6px;border-radius:9999px;font-size:10px;font-weight:700;">
                  <i class="fas fa-circle" style="font-size:6px;color:#93c5fd;margin-right:2px;"></i>Arc Commerce
                </span>
                <span>Pay with USDC \xB7 Arc Testnet</span>
                <span id="arc-pd-balance" style="margin-left:auto;font-weight:600;"></span>
              </div>` : `<div class="pd-outofstock">
                <i class="fas fa-box-open" style="font-size:28px;opacity:.3;display:block;margin-bottom:8px"></i>
                <p style="font-weight:700;font-size:15px;color:#64748b;margin-bottom:4px">Out of Stock</p>
                <p style="font-size:12px;color:#94a3b8">This product is currently unavailable</p>
              </div>`}
        </div>

        <!-- Seller Management Panel (shown only if viewer is the seller) -->
        <div id="seller-actions" class="hidden pd-seller-panel">
          <div class="title"><i class="fas fa-store"></i> Your Listing</div>
          <p>You are the seller of this product. You cannot purchase your own listing.</p>
        </div>

      </div>
    </div>

    <!-- Back link -->
    <div class="mt-10 pt-6 border-t border-slate-100">
      <a href="/marketplace" class="btn-secondary text-sm py-2 px-4">
        <i class="fas fa-arrow-left"></i> Back to Marketplace
      </a>
    </div>
  </div>

  <!-- Mobile sticky buy bar -->
  ${stockN > 0 ? `
  <div class="pd-sticky-bar" id="pd-sticky-bar">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px;color:#64748b;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
      <div style="font-size:18px;font-weight:900;color:#dc2626;line-height:1.2">${price} <span style="font-size:13px;font-weight:700">${tok}</span></div>
    </div>
    <button onclick="pdBuyNow('${p.id}','${title.replace(/'/g, "\\'")}',${price},'${tok}','${imgUrl}')"
      class="pd-btn-buy" style="width:auto;padding:13px 22px;font-size:14px;flex-shrink:0">
      <i class="fas fa-bolt"></i> Buy Now
    </button>
  </div>` : ""}

  <script>
  (function(){
    // Self-purchase check: hide buy buttons if viewer is the seller
    const sellerAddr = '${seller}'.toLowerCase();
    const w = getStoredWallet();
    if(w && sellerAddr && w.address.toLowerCase() === sellerAddr){
      const btns = document.getElementById('product-action-btns');
      const panel = document.getElementById('seller-actions');
      const bar = document.getElementById('pd-sticky-bar');
      if(btns) btns.classList.add('hidden');
      if(panel) panel.classList.remove('hidden');
      if(bar) bar.style.display = 'none';
    }
  })();

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  ESCROW-AWARE BUY BUTTON \u2014 Dynamic state following escrow lifecycle
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  
  const ESCROW_STATES = {
    IDLE: 'idle',                      // No interaction yet
    PENDING_DEPOSIT: 'pending_deposit', // Escrow initialized, awaiting deposit
    LOCKED: 'locked',                  // Funds deposited and locked
    SHIPPED: 'shipped',                // Seller marked as shipped
    COMPLETED: 'completed',            // Delivery confirmed, funds released
    DISPUTED: 'disputed'               // Dispute opened
  };

  const BUTTON_CONFIG = {
    [ESCROW_STATES.IDLE]: {
      label: (price, token) => \`<i class="fas fa-bolt"></i> Buy Now &mdash; \${price} \${token}\`,
      action: 'initiate',
      disabled: false,
      class: 'pd-btn-buy'
    },
    [ESCROW_STATES.PENDING_DEPOSIT]: {
      label: () => '<i class="fas fa-coins"></i> Deposit to Escrow',
      action: 'deposit',
      disabled: false,
      class: 'pd-btn-buy'
    },
    [ESCROW_STATES.LOCKED]: {
      label: () => '<i class="fas fa-clock"></i> Awaiting Shipment',
      action: 'none',
      disabled: true,
      class: 'pd-btn-waiting'
    },
    [ESCROW_STATES.SHIPPED]: {
      label: () => '<i class="fas fa-check-circle"></i> Confirm Delivery',
      action: 'confirm',
      disabled: false,
      class: 'pd-btn-confirm'
    },
    [ESCROW_STATES.COMPLETED]: {
      label: () => '<i class="fas fa-check-double"></i> Completed',
      action: 'none',
      disabled: true,
      class: 'pd-btn-completed'
    },
    [ESCROW_STATES.DISPUTED]: {
      label: () => '<i class="fas fa-exclamation-triangle"></i> Resolve Dispute',
      action: 'dispute',
      disabled: false,
      class: 'pd-btn-dispute'
    }
  };

  // Get current escrow state for this product
  async function getProductEscrowState(productId) {
    try {
      // Check localStorage for existing orders first
      const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
      const wallet = getStoredWallet();
      if (!wallet) return ESCROW_STATES.IDLE;

      const myAddr = wallet.address.toLowerCase();
      const order = orders.find(o => 
        o.productId === productId && 
        o.buyerAddress && 
        o.buyerAddress.toLowerCase() === myAddr
      );

      if (!order) return ESCROW_STATES.IDLE;

      // Map order status to escrow state
      const statusMap = {
        'escrow_pending': ESCROW_STATES.PENDING_DEPOSIT,
        'escrow_locked': ESCROW_STATES.LOCKED,
        'shipped': ESCROW_STATES.SHIPPED,
        'delivery_confirmed': ESCROW_STATES.COMPLETED,
        'funds_released': ESCROW_STATES.COMPLETED,
        'completed': ESCROW_STATES.COMPLETED,
        'dispute': ESCROW_STATES.DISPUTED
      };

      return statusMap[order.status] || ESCROW_STATES.IDLE;
    } catch (e) {
      console.error('[getProductEscrowState] error:', e);
      return ESCROW_STATES.IDLE;
    }
  }

  // Update buy button based on escrow state
  async function updateBuyButton(productId, productName, price, token, image) {
    const btn = document.getElementById('btn-buy-now');
    const stickyBtn = document.querySelector('.pd-sticky-bar button');
    if (!btn) return;

    const state = await getProductEscrowState(productId);
    const config = BUTTON_CONFIG[state];
    
    if (!config) return;

    // Update button appearance
    btn.className = config.class;
    btn.innerHTML = typeof config.label === 'function' 
      ? config.label(price, token) 
      : config.label;
    btn.disabled = config.disabled;

    // Update sticky button if exists
    if (stickyBtn) {
      stickyBtn.className = config.class + ' pd-btn-buy';
      stickyBtn.innerHTML = typeof config.label === 'function'
        ? config.label(price, token)
        : config.label;
      stickyBtn.disabled = config.disabled;
    }

    // Set up action handler
    btn.onclick = null; // Clear old handler
    if (stickyBtn) stickyBtn.onclick = null;

    if (!config.disabled) {
      const handler = () => handleBuyButtonAction(config.action, productId, productName, price, token, image);
      btn.onclick = handler;
      if (stickyBtn) stickyBtn.onclick = handler;
    }

    // Auto-refresh every 10 seconds to sync with contract state
    setTimeout(() => updateBuyButton(productId, productName, price, token, image), 10000);
  }

  // Handle different button actions based on escrow state
  function handleBuyButtonAction(action, id, name, price, token, image) {
    switch (action) {
      case 'initiate':
        pdBuyNow(id, name, price, token, image);
        break;
      case 'deposit':
        // Redirect to checkout to complete deposit
        showToast('Redirecting to checkout to complete deposit\u2026', 'info');
        window.location.href = '/checkout';
        break;
      case 'confirm':
        // Redirect to orders page to confirm delivery
        showToast('Redirecting to your orders to confirm delivery\u2026', 'info');
        window.location.href = '/orders';
        break;
      case 'dispute':
        showToast('Redirecting to disputes\u2026', 'info');
        window.location.href = '/disputes';
        break;
      default:
        console.log('[handleBuyButtonAction] No action for:', action);
    }
  }

  // Original buy now function (initiate purchase)
  function pdBuyNow(id, name, price, token, image) {
    const btn = document.getElementById('btn-buy-now');
    if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing\u2026'; }
    CartStore.addToCart({ id, title: name, price: parseFloat(price), currency: token, image });
    setTimeout(() => window.location.href = '/cart', 400);
  }
  function pdAddCart(id, name, price, token, image) {
    const btn = document.getElementById('btn-add-cart');
    if(btn){ btn.disabled = true; btn.innerHTML = '<i class="fas fa-check"></i> Added!'; }
    CartStore.addToCart({ id, title: name, price: parseFloat(price), currency: token, image });
    showToast('Added to cart!', 'success');
    setTimeout(() => { if(btn){ btn.disabled = false; btn.innerHTML = '<i class="fas fa-cart-plus"></i> Add to Cart'; } }, 1800);
  }
  // Keep legacy names working (called by other scripts)
  function addToCartOnly(id, name, price, token, image) { pdAddCart(id, name, price, token, image); }
  function addToCartAndBuy(id, name, price, token, image) { pdBuyNow(id, name, price, token, image); }

  function pdCopySeller() {
    const addr = '${seller}';
    if(!addr) return;
    navigator.clipboard.writeText(addr).then(() => {
      const btn = document.getElementById('pd-copy-seller');
      if(btn){ btn.classList.add('copied'); btn.innerHTML = '<i class="fas fa-check"></i>'; }
      showToast('Seller address copied!', 'success');
      setTimeout(() => { if(btn){ btn.classList.remove('copied'); btn.innerHTML = '<i class="fas fa-copy"></i>'; } }, 2000);
    }).catch(() => showToast('Copy not available', 'error'));
  }

  // Initialize escrow-aware button on page load
  (function() {
    const productId = '${p.id}';
    const productName = '${title.replace(/'/g, "\\'")}';
    const price = ${price};
    const token = '${tok}';
    const image = '${imgUrl}';
    
    // Update button state on load
    updateBuyButton(productId, productName, price, token, image);
  })();

  // \u2500\u2500 Arc Commerce: lazy-load USDC balance badge on product page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  (function(){
    async function loadArcBadge() {
      const badge = document.getElementById('arc-pd-badge');
      if (!badge) return;

      // Wait for ArcPayments to be available (loaded via defer)
      let tries = 0;
      while (typeof window.ArcPayments === 'undefined' && tries++ < 30) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (!window.ArcPayments) return;

      const wallet = getStoredWallet();
      if (!wallet || !wallet.address) return; // no wallet \u2014 keep badge hidden

      // Show badge
      badge.style.display = 'flex';

      const balEl = document.getElementById('arc-pd-balance');
      if (balEl) balEl.textContent = '\u2026';

      try {
        const res = await Promise.race([
          window.ArcPayments.getBalance(wallet.address, 'USDC'),
          new Promise(r => setTimeout(() => r({ ok: false }), 4000))
        ]);
        if (balEl) {
          balEl.textContent = res.ok ? parseFloat(res.balance).toFixed(2) + ' USDC' : '';
        }
      } catch (_) {
        if (balEl) balEl.textContent = '';
      }
    }
    // Run after DOM settles, non-blocking
    setTimeout(loadArcBadge, 800);
  })();

  // Breadcrumb scroll behavior \u2014 hides on scroll up, shows on scroll down
  (function(){
    const breadcrumb = document.querySelector('.pd-breadcrumb');
    if(!breadcrumb) return;

    let lastScroll = 0;
    let ticking = false;

    window.addEventListener('scroll', () => {
      if(!ticking) {
        window.requestAnimationFrame(() => {
          const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
          
          // Hide breadcrumb when scrolling up
          if(currentScroll < lastScroll && currentScroll > 100) {
            breadcrumb.classList.add('hidden-scroll');
          }
          // Show breadcrumb when scrolling down or at top
          else if(currentScroll > lastScroll || currentScroll <= 100) {
            breadcrumb.classList.remove('hidden-scroll');
          }
          
          lastScroll = currentScroll <= 0 ? 0 : currentScroll;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  })();

  // Sticky bar \u2014 appears on scroll down, hides on scroll up
  (function(){
    const bar = document.getElementById('pd-sticky-bar');
    if(!bar) return;

    let lastScroll = 0;
    let ticking = false;

    window.addEventListener('scroll', () => {
      if(!ticking) {
        window.requestAnimationFrame(() => {
          const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
          
          // Show bar when scrolling down past 200px
          if(currentScroll > 200 && currentScroll > lastScroll) {
            bar.classList.add('visible');
          }
          // Hide bar when scrolling up or at top
          else if(currentScroll < lastScroll || currentScroll < 150) {
            bar.classList.remove('visible');
          }
          
          lastScroll = currentScroll <= 0 ? 0 : currentScroll;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  })();
  </script>
  `);
}
function cartPage() {
  return shell("Cart", `
  <div class="max-w-5xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-shopping-cart text-red-500"></i> Your Cart
    </h1>
    <div class="flex flex-col lg:flex-row gap-8">
      <div class="flex-1" id="cart-items">
        <div class="card p-12 text-center" id="empty-cart-msg">
          <div class="empty-state">
            <i class="fas fa-shopping-cart"></i>
            <p class="font-medium text-slate-600">Your cart is empty</p>
            <a href="/marketplace" class="btn-primary mt-4 mx-auto">Browse Marketplace</a>
          </div>
        </div>
      </div>
      <div class="w-full lg:w-80">
        <div class="card p-6 sticky top-20">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Order Summary</h2>
          <div class="space-y-3 text-sm mb-4">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="subtotal">0.00 USDC</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="platform-fee">0.00</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas Estimate</span><span id="gas-fee">~0.01 USDC</span></div>
            <div class="border-t pt-3 flex justify-between font-bold text-lg">
              <span>Total</span><span id="total-price" class="text-red-600">0.00 USDC</span>
            </div>
          </div>
          <div id="wallet-required-msg" class="hidden network-warning mb-3 text-xs">
            <i class="fas fa-exclamation-triangle"></i> Connect wallet to checkout
          </div>
          <a href="/checkout" id="checkout-btn" class="btn-primary w-full justify-center py-3 text-base">
            <i class="fas fa-lock"></i> Proceed to Checkout
          </a>
          <a href="/marketplace" class="btn-secondary w-full justify-center mt-2 text-sm">Continue Shopping</a>
          <p class="text-slate-400 text-xs text-center mt-3">
            <i class="fas fa-shield-alt text-red-400 mr-1"></i>Secured by Arc Network escrow
          </p>
        </div>
      </div>
    </div>
  </div>
  <script>
  // \u2500\u2500 Cart page helpers \u2014 all read/write via CartStore \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function renderCart() {
    const cart      = CartStore.getCart();
    const container = document.getElementById('cart-items');
    const emptyMsg  = document.getElementById('empty-cart-msg');

    if (!cart.length) {
      emptyMsg.style.display  = 'block';
      container.innerHTML     = '';
      // zero totals
      ['subtotal','platform-fee','total-price'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '0.00 USDC';
      });
      const gasEl = document.getElementById('gas-fee');
      if (gasEl) gasEl.textContent = '~0.00 USDC';
      return;
    }
    emptyMsg.style.display = 'none';
    let subtotal = 0, gas = 0;
    const rows = [];
    for (const item of cart) {
      const qty   = item.quantity || 1;
      const price = parseFloat(item.price) || 0;
      const cur   = item.currency || item.token || 'USDC';
      const title = (item.title || item.name || 'Product').replace(/</g,'&lt;');
      const id    = (item.id || '').replace(/"/g,'');
      subtotal += price * qty;
      gas      += 0.01;
      const imgHtml = item.image
        ? '<img src="' + item.image + '" class="w-16 h-16 rounded-xl object-cover flex-shrink-0" onerror="this.style.display=&quot;none&quot;">'
        : '<div class="w-16 h-16 rounded-xl bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-box"></i></div>';
      rows.push(
        '<div class="card p-4 mb-3 flex items-center gap-4">'
        + imgHtml
        + '<div class="flex-1 min-w-0">'
        + '<p class="font-semibold text-slate-800 text-sm truncate">' + title + '</p>'
        + '<p class="text-red-600 font-bold text-sm">' + price.toFixed(2) + ' ' + cur + '</p>'
        + '<p class="text-xs text-slate-400">Qty: ' + qty + '</p>'
        + '</div>'
        + '<div class="flex items-center gap-2 flex-shrink-0">'
        + '<button data-id="' + id + '" data-delta="-1" class="qty-btn w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">\u2212</button>'
        + '<span class="font-bold w-6 text-center text-sm">' + qty + '</span>'
        + '<button data-id="' + id + '" data-delta="1" class="qty-btn w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-red-100 font-bold text-sm">+</button>'
        + '</div>'
        + '<button data-id="' + id + '" class="rm-btn text-red-400 hover:text-red-600 ml-2 flex-shrink-0"><i class="fas fa-trash text-sm"></i></button>'
        + '</div>'
      );
    }
    container.innerHTML = rows.join('');
    // Attach click handlers via event delegation (avoids inline onclick quoting issues)
    container.querySelectorAll('.qty-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        cartChangeQty(this.dataset.id, parseInt(this.dataset.delta));
      });
    });
    container.querySelectorAll('.rm-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { cartRemove(this.dataset.id); });
    });

    const fee = subtotal * 0.015;
    const tok = cart[0]?.currency || cart[0]?.token || 'USDC';
    document.getElementById('subtotal').textContent      = subtotal.toFixed(2) + ' ' + tok;
    document.getElementById('platform-fee').textContent  = fee.toFixed(4)      + ' ' + tok;
    document.getElementById('gas-fee').textContent       = '~' + gas.toFixed(2) + ' USDC';
    document.getElementById('total-price').textContent   = (subtotal + fee).toFixed(2) + ' ' + tok;

    const w = getStoredWallet();
    if (!w) document.getElementById('wallet-required-msg')?.classList.remove('hidden');
  }

  function cartChangeQty(id, delta) {
    CartStore.changeQty(id, delta);
    renderCart();
  }
  function cartRemove(id) {
    CartStore.removeFromCart(id);
    renderCart();
    showToast('Item removed from cart', 'info');
  }

  document.addEventListener('DOMContentLoaded', renderCart);
  </script>
  `);
}
function checkoutPage() {
  return shell("Checkout", `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-lock text-red-500"></i> Secure Checkout
    </h1>
    <p class="text-slate-500 mb-6">Funds are locked in escrow on Arc Network until delivery is confirmed.</p>

    <!-- Network check -->
    <div id="co-network-status" class="mb-6"></div>

    <!-- Escrow flow -->
    <div class="card p-5 mb-8">
      <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
        <i class="fas fa-route text-red-500"></i> Escrow Flow on Arc Network
      </h3>
      <div class="flex items-center gap-2 overflow-x-auto pb-2">
        ${[["Confirm", "fas fa-check"], ["Lock USDC/EURC", "fas fa-lock"], ["Seller Ships", "fas fa-shipping-fast"], ["You Confirm", "fas fa-box-open"], ["Released", "fas fa-coins"]].map(([label, icon], i) => `
          <div class="flex items-center gap-2 shrink-0">
            <div class="flex flex-col items-center">
              <div class="w-10 h-10 rounded-full ${i === 0 ? "bg-red-600 text-white" : "bg-slate-200 text-slate-400"} flex items-center justify-center">
                <i class="${icon} text-sm"></i>
              </div>
              <p class="text-xs text-center mt-1 ${i === 0 ? "text-red-600 font-medium" : "text-slate-400"} w-16">${label}</p>
            </div>
            ${i < 4 ? '<div class="w-8 h-0.5 bg-slate-200 mb-5"></div>' : ""}
          </div>`).join("")}
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div class="space-y-6">
        <!-- Token selection -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-800 mb-4">Payment Token</h3>
          <div class="grid grid-cols-2 gap-3">
            <label class="cursor-pointer">
              <input type="radio" name="token" value="USDC" checked class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center"><span class="font-bold text-blue-700">$</span></div>
                <div><p class="font-bold text-slate-800">USDC</p><p class="text-slate-400 text-xs">Native on Arc</p></div>
              </div>
            </label>
            <label class="cursor-pointer">
              <input type="radio" name="token" value="EURC" class="sr-only peer"/>
              <div class="card p-4 flex items-center gap-3 peer-checked:border-red-500 peer-checked:bg-red-50 hover:border-red-300 transition-all">
                <div class="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center"><span class="font-bold text-indigo-700">\u20AC</span></div>
                <div><p class="font-bold text-slate-800">EURC</p><p class="text-slate-400 text-xs">Euro stablecoin</p></div>
              </div>
            </label>
          </div>
        </div>
        <!-- Shipping -->
        <div class="card p-5">
          <h3 class="font-bold text-slate-800 mb-4">Shipping Address</h3>
          <div class="space-y-3">
            <input type="text" placeholder="Full Name" class="input"/>
            <input type="email" placeholder="Email Address" class="input"/>
            <input type="text" placeholder="Street Address" class="input"/>
            <div class="grid grid-cols-2 gap-3">
              <input type="text" placeholder="City" class="input"/>
              <input type="text" placeholder="ZIP Code" class="input"/>
            </div>
            <select class="select"><option>Select Country</option><option>United States</option><option>United Kingdom</option><option>Germany</option><option>Brazil</option><option>Other</option></select>
          </div>
        </div>
      </div>

      <div>
        <div class="card p-5 mb-4">
          <h3 class="font-bold text-slate-800 mb-4">Order Summary</h3>
          <div id="co-items" class="space-y-3 mb-4 text-sm">
            <div class="text-slate-400 text-center py-4">Loading\u2026</div>
          </div>
          <div class="border-t pt-4 space-y-2 text-sm">
            <div class="flex justify-between text-slate-600"><span>Subtotal</span><span id="co-sub">\u2014</span></div>
            <div class="flex justify-between text-slate-600"><span>Platform Fee (1.5%)</span><span id="co-fee">\u2014</span></div>
            <div class="flex justify-between text-slate-600"><span>Gas (Arc Network)</span><span class="text-blue-600">~0.01 USDC</span></div>
            <div class="flex justify-between text-slate-400 text-xs"><span>Government Fee</span><span>\u2014</span></div>
            <div class="border-t pt-2 flex justify-between font-extrabold text-lg">
              <span>Total</span><span id="co-total" class="text-red-600">\u2014</span>
            </div>
          </div>
        </div>

        <!-- Wallet status -->
        <div class="card p-4 mb-4" id="co-wallet-card">
          <div class="flex items-center gap-3" id="co-wallet-inner">
            <div class="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600">
              <i class="fas fa-exclamation-triangle"></i>
            </div>
            <div>
              <p class="font-semibold text-slate-800 text-sm">No wallet connected</p>
              <p class="text-slate-400 text-xs">Connect to Arc Testnet to checkout</p>
            </div>
          </div>
          <a href="/wallet" id="co-wallet-link" class="btn-secondary w-full justify-center text-sm mt-3">
            <i class="fas fa-wallet"></i> Connect Wallet
          </a>
        </div>

        <button onclick="confirmOrder()" id="co-confirm-btn" class="btn-primary w-full justify-center py-4 text-base font-bold">
          <i class="fas fa-lock mr-2"></i> Confirm & Lock Funds
        </button>
        <div class="mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
          <p class="font-semibold flex items-center gap-1"><i class="fas fa-info-circle"></i> 3-step on-chain escrow</p>
          <p><span class="font-medium">Step 1:</span> Approve ShuklyEscrow to spend your tokens (one-time)</p>
          <p><span class="font-medium">Step 2:</span> Create escrow slot on-chain (<code>createEscrow</code>)</p>
          <p><span class="font-medium">Step 3:</span> Lock funds in escrow (<code>fundEscrow</code>) \u2014 "to" = escrow contract, never seller</p>
        </div>

        <!-- \u2500\u2500 Arc Commerce \u2014 USDC balance & payment status \u2500\u2500 -->
        <div id="arc-payment-status" class="mt-3 p-3 rounded-lg border text-xs hidden">
          <!-- populated by initArcPaymentUI() -->
        </div>

        <!-- \u2500\u2500 Pay without wallet \u2500\u2500 (rendered by renderNoWalletPayOption when no wallet) -->
        <div id="co-no-wallet-section" class="hidden mt-4"></div>

      </div>
    </div>
  </div>

  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('co-network-status'));
    const cart = getCart();
    const container = document.getElementById('co-items');
    if (!cart.length) {
      container.innerHTML = '<div class="text-center text-slate-400 py-4">Cart is empty. <a href="/marketplace" class="text-red-600">Browse products</a></div>';
      return;
    }
    let total=0;
    container.innerHTML = cart.map(item => {
      const qty  = item.quantity || item.qty || 1;
      const price= parseFloat(item.price) || 0;
      const title= (item.title || item.name || 'Product').replace(/</g,'&lt;');
      const cur  = item.currency || item.token || 'USDC';
      total += price * qty;
      return '<div class="flex items-center gap-3">'
        +(item.image?'<img src="'+item.image+'" class="w-12 h-12 rounded-lg object-cover object-center" onerror="this.style.display=&quot;none&quot;"/>'
                   :'<div class="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300 flex-shrink-0"><i class="fas fa-box"></i></div>')
        +'<div class="flex-1 min-w-0"><p class="font-medium text-slate-800 text-xs truncate">'+title+'</p>'
        +'<p class="text-slate-400 text-xs">Qty: '+qty+'</p></div>'
        +'<p class="font-bold text-red-600 text-sm flex-shrink-0">'+(price*qty).toFixed(2)+' '+cur+'</p></div>';
    }).join('');
    const fee=total*0.015;
    const mainCur = cart[0]?.currency || cart[0]?.token || 'USDC';
    document.getElementById('co-sub').textContent=total.toFixed(2)+' '+mainCur;
    document.getElementById('co-fee').textContent=fee.toFixed(4)+' '+mainCur;
    document.getElementById('co-total').textContent=(total+fee).toFixed(2)+' '+mainCur;

    const w=getStoredWallet();
    if(w){
      document.getElementById('co-wallet-inner').innerHTML =
        '<div class="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-green-600"><i class="fas fa-check-circle"></i></div>'
        +'<div><p class="font-semibold text-slate-800 text-sm">Wallet Connected</p>'
        +'<p class="text-slate-400 text-xs addr-mono">'+w.address+'</p></div>';
      document.getElementById('co-wallet-link').style.display='none';
    }

    // \u2500\u2500 Arc Commerce: show USDC balance panel (non-blocking) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    initArcPaymentUI(w);

    // \u2500\u2500 Pay-without-wallet: only show section when NOT connected \u2500\u2500\u2500\u2500\u2500
    if (!w) {
      renderNoWalletPayOption(total, fee, mainCur);
    }
  });

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  confirmOrder \u2014 Direct ShuklyEscrow contract calls (no relayer)
  //
  //  Flow (all on-chain, user signs each tx with their own wallet):
  //   1. approve(escrowAddress, MaxUint256)  \u2014 ERC-20 approval
  //   2. createEscrow(orderId32, seller, token, amount)
  //   3. fundEscrow(orderId32)              \u2014 pulls tokens into escrow
  //
  //  Funds go to ShuklyEscrow contract ONLY \u2014 never directly to seller.
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  async function confirmOrder() {
    const btn = document.getElementById('co-confirm-btn');
    function resetBtn() {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Confirm & Lock Funds'; }
    }
    function setBtn(text) {
      if (btn) btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>' + text;
      // \u2500\u2500 Arc Commerce: mirror step in status panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      updateArcPaymentStatus('loading', text);
    }

    // \u2500\u2500 1. Wallet check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const w = getStoredWallet();
    if (!w) {
      showToast('Connect a wallet first \u2014 redirecting\u2026', 'error');
      setTimeout(() => { window.location.href = '/wallet'; }, 1200);
      return;
    }

    // \u2500\u2500 2. Network check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (w.type === 'metamask' && window.ethereum) {
      const onArc = await isOnArcNetwork();
      if (!onArc) {
        showToast('Switching to Arc Testnet\u2026', 'info');
        const switched = await switchToArc();
        if (!switched) {
          showToast('Please switch to Arc Testnet in MetaMask manually', 'warning');
          return;
        }
      }
    }

    // \u2500\u2500 3. Cart check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const cart = getCart();
    if (!cart.length) { showToast('Cart is empty', 'error'); return; }

    // \u2500\u2500 4. Escrow contract check \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const escrowAddress = getEscrowAddress();
    console.log('[confirmOrder] escrowAddress:', escrowAddress);
    if (!isEscrowDeployed()) {
      showToast('Escrow contract not configured. Contact support or deploy at /deploy-escrow.', 'error');
      console.error('[confirmOrder] ShuklyEscrow address is zero/unset. Set window.ARC.contracts.ShuklyEscrow or deploy.');
      return;
    }

    // \u2500\u2500 5. Calculate amount & token \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const total = cart.reduce((s, i) => s + (parseFloat(i.price) || 0) * ((i.quantity || i.qty) || 1), 0);
    const tokenSel = document.querySelector('input[name="token"]:checked');
    const token = tokenSel ? tokenSel.value : 'USDC';
    const tokenAddress = token === 'USDC' ? window.ARC.contracts.USDC : window.ARC.contracts.EURC;
    console.log('[confirmOrder] token:', token, tokenAddress, 'amount:', total);

    // \u2500\u2500 6. Resolve seller \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let sellerAddress = null;
    try {
      const pid = cart[0]?.id;
      if (pid) {
        const resp = await fetch('/api/products/' + pid);
        const data = await resp.json();
        if (data.product?.seller_id && data.product.seller_id.startsWith('0x')) {
          sellerAddress = data.product.seller_id;
        }
      }
    } catch (e) { console.warn('[confirmOrder] seller fetch error:', e); }

    if (!sellerAddress) {
      showToast('Could not resolve seller address from product API', 'error');
      console.error('[confirmOrder] sellerAddress missing');
      return;
    }
    
    // CRITICAL: Check buyer != seller BEFORE any transaction
    if (w.address.toLowerCase() === sellerAddress.toLowerCase()) {
      showToast('You cannot purchase your own product', 'error');
      console.error('[confirmOrder] Blocked: buyer === seller');
      resetBtn();
      return;
    }
    console.log('[confirmOrder] sellerAddress:', sellerAddress);

    // \u2500\u2500 7. Confirmation modal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const confirmed = await showTxConfirmModal({
      action:  'Lock Funds in Escrow',
      amount:  total.toFixed(2),
      token:   token,
      network: 'Arc Testnet (Chain ID: 5042002)',
      note:    "Funds go to ShuklyEscrow - released only after delivery confirmation. to=escrow contract, NOT the seller."
    });
    if (!confirmed) { showToast('Transaction cancelled', 'info'); return; }

    if (btn) btn.disabled = true;
    setBtn('Connecting to wallet\u2026');

    // \u2500\u2500 8. Get signer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    let provider, signer;
    try {
      if (w.type === 'metamask' && window.ethereum) {
        provider = new ethers.BrowserProvider(window.ethereum);
        await provider.send('eth_requestAccounts', []);  // ensure MetaMask is unlocked
        signer = await provider.getSigner();
        console.log('[confirmOrder] MetaMask signer:', await signer.getAddress());
      } else if ((w.type === 'internal' || w.type === 'imported') && w.privateKey && !w.privateKey.startsWith('[')) {
        provider = new ethers.JsonRpcProvider(window.ARC.rpc);
        signer = new ethers.Wallet(w.privateKey, provider);
        console.log('[confirmOrder] Internal signer:', signer.address);
      } else {
        showToast('Private key unavailable. Re-import wallet with seed phrase.', 'error');
        resetBtn(); return;
      }
    } catch (err) {
      const msg = err.code === 4001 || err.code === 'ACTION_REJECTED'
        ? 'Wallet connection rejected by user'
        : 'Wallet error: ' + (err.message || String(err));
      showToast(msg, 'error');
      console.error('[confirmOrder] signer error:', err);
      resetBtn(); return;
    }

    // \u2500\u2500 9. Build amount & orderId \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const amountWei = ethers.parseUnits((Math.round(total * 1_000_000) / 1_000_000).toFixed(6), 6);
    const orderId   = 'ORD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const orderId32 = ethers.id(orderId);
    console.log('[confirmOrder] orderId:', orderId, '\u2192 bytes32:', orderId32);
    console.log('[confirmOrder] amountWei:', amountWei.toString());

    const erc20Contract  = new ethers.Contract(tokenAddress,  ERC20_ABI,  signer);
    const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

    // \u2550\u2550 PRE-VALIDATION: Check token balance \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    try {
      const signerAddr = await signer.getAddress();
      const balance = await erc20Contract.balanceOf(signerAddr);
      console.log('[confirmOrder] Token balance:', ethers.formatUnits(balance, 6), token);
      
      if (balance < amountWei) {
        const needed = ethers.formatUnits(amountWei, 6);
        const have = ethers.formatUnits(balance, 6);
        showToast('Insufficient balance: you have ' + have + ' ' + token + ', need ' + needed + ' ' + token + '. Get tokens at faucet.circle.com', 'error');
        console.error('[confirmOrder] Insufficient balance:', have, '<', needed);
        console.log('[confirmOrder] Get test tokens at: https://faucet.circle.com');
        resetBtn();
        return;
      }
    } catch (err) {
      console.warn('[confirmOrder] Balance check failed:', err);
      // Continue anyway - will fail at tx time if really insufficient
    }

    // \u2550\u2550 STEP 1/3: ERC-20 approve \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    let approveTxHash = null;
    try {
      setBtn('Step 1/3 \u2014 Checking allowance\u2026');
      const signerAddr = await signer.getAddress();
      const allowance = await erc20Contract.allowance(signerAddr, escrowAddress);
      console.log('[confirmOrder] allowance:', allowance.toString(), 'need:', amountWei.toString());

      if (allowance < amountWei) {
        setBtn('Step 1/3 \u2014 Approve token spend (confirm in wallet)\u2026');
        showToast('Step 1/3: Approve ' + token + ' for escrow \u2014 confirm in wallet\u2026', 'info');
        const approveTx = await erc20Contract.approve(escrowAddress, ethers.MaxUint256);
        console.log('[confirmOrder] approve tx:', approveTx.hash);
        setBtn('Step 1/3 \u2014 Waiting for approval confirmation\u2026');
        showToast('Approval tx sent: ' + approveTx.hash.slice(0, 14) + '\u2026 Waiting\u2026', 'info');
        const approveReceipt = await approveTx.wait(1);
        if (!approveReceipt || approveReceipt.status === 0) throw new Error('Approval tx reverted on-chain');
        approveTxHash = approveTx.hash;
        showToast('Token approved! \u2713 Tx: ' + approveTx.hash.slice(0, 14) + '\u2026', 'success');
      } else {
        showToast('Allowance sufficient \u2713 \u2014 skipping approve', 'success');
      }
    } catch (err) {
      const msg = (err.code === 'ACTION_REJECTED' || err.code === 4001)
        ? 'Approval rejected by user'
        : 'Approval failed: ' + (err.shortMessage || err.reason || err.message || String(err));
      showToast(msg, 'error');
      console.error('[confirmOrder] approve error:', err);
      resetBtn(); return;
    }

    // \u2550\u2550 STEP 2/3: createEscrow \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    let createTxHash = null;
    try {
      setBtn('Step 2/3 \u2014 Creating escrow slot (confirm in wallet)\u2026');
      showToast('Step 2/3: createEscrow \u2014 confirm in wallet\u2026', 'info');
      console.log('[confirmOrder] createEscrow args:', orderId32, sellerAddress, tokenAddress, amountWei.toString());

      // Arc Testnet eth_estimateGas can fail silently \u2014 pass explicit gasLimit to skip estimation
      const createTx = await escrowContract.createEscrow(orderId32, sellerAddress, tokenAddress, amountWei, { gasLimit: 300000 });
      console.log('[confirmOrder] createEscrow tx:', createTx.hash);
      setBtn('Step 2/3 \u2014 Waiting for createEscrow confirmation\u2026');
      showToast('createEscrow sent: ' + createTx.hash.slice(0, 14) + '\u2026 Waiting\u2026', 'info');

      const createReceipt = await createTx.wait(1);
      if (!createReceipt || createReceipt.status === 0) throw new Error('createEscrow tx reverted \u2014 check contract address and inputs');
      createTxHash = createTx.hash;
      showToast('Escrow slot created! \u2713 Tx: ' + createTx.hash.slice(0, 14) + '\u2026', 'success');
    } catch (err) {
      // Decode revert reason: Arc Testnet often returns no revert data
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'Transaction rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        // Likely: buyer == seller, escrow already exists, or invalid inputs
        const buyerAddr = (await signer.getAddress()).toLowerCase();
        if (buyerAddr === sellerAddress.toLowerCase()) {
          msg = 'Error: you cannot purchase your own product';
        } else {
          msg = 'createEscrow reverted. Possible causes: Insufficient ' + token + ' balance, Invalid addresses, Escrow already exists with this ID';
        }
      } else if (err.message && err.message.includes('execution reverted')) {
        // Generic revert - provide helpful guidance
        msg = 'Transaction reverted in contract. Check: Do you have enough ' + token + '? Is seller address correct? Not buying your own product?';
      } else {
        msg = 'createEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      console.error('[confirmOrder] createEscrow error:', err);
      console.error('[confirmOrder] Full error object:', JSON.stringify(err, null, 2));
      resetBtn(); return;
    }

    // \u2550\u2550 STEP 3/3: fundEscrow \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    let fundTxHash = null;
    try {
      setBtn('Step 3/3 \u2014 Locking funds in escrow (confirm in wallet)\u2026');
      showToast('Step 3/3: fundEscrow \u2014 confirm in wallet\u2026', 'info');
      console.log('[confirmOrder] fundEscrow orderId32:', orderId32);

      // Arc Testnet eth_estimateGas can fail silently \u2014 pass explicit gasLimit
      const fundTx = await escrowContract.fundEscrow(orderId32, { gasLimit: 200000 });
      console.log('[confirmOrder] fundEscrow tx:', fundTx.hash);
      setBtn('Step 3/3 \u2014 Waiting for fundEscrow confirmation\u2026');
      showToast('fundEscrow sent: ' + fundTx.hash.slice(0, 14) + '\u2026 Waiting\u2026', 'info');

      const fundReceipt = await fundTx.wait(1);
      if (!fundReceipt || fundReceipt.status === 0) throw new Error('fundEscrow tx reverted \u2014 check token allowance and escrow state');
      fundTxHash = fundTx.hash;
      showToast('Funds locked in escrow! \u2713 Tx: ' + fundTx.hash.slice(0, 14) + '\u2026', 'success');
    } catch (err) {
      let msg;
      if (err.code === 'ACTION_REJECTED' || err.code === 4001) {
        msg = 'fundEscrow rejected by user';
      } else if (err.message && err.message.includes('missing revert data')) {
        msg = 'fundEscrow reverted by Arc network. Check if ' + token + ' approve was confirmed and sufficient balance exists.';
      } else {
        msg = 'fundEscrow falhou: ' + (err.shortMessage || err.reason || err.message || String(err));
      }
      showToast(msg, 'error');
      console.error('[confirmOrder] fundEscrow error:', err);
      resetBtn(); return;
    }

    // \u2550\u2550 Save order \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    const orderData = {
      orderId, orderId32,
      txHash:       createTxHash,
      fundTxHash,
      buyerAddress: w.address,
      sellerAddress,
      amount:       total,
      token,
      productId:    cart[0]?.id || '',
      items:        cart
    };

    // Backend save (optional \u2014 best effort)
    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData)
      });
    } catch (e) { console.warn('[confirmOrder] backend save error:', e); }

    // LocalStorage save
    const savedOrders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    savedOrders.unshift({
      id:             orderId,
      orderId32,
      txHash:         createTxHash,
      fundTxHash,
      buyerAddress:   w.address,
      sellerAddress,
      escrowContract: escrowAddress,
      amount:         total,
      token,
      productId:      cart[0]?.id || '',
      items:          cart,
      status:         'escrow_locked',
      createdAt:      new Date().toISOString(),
      explorerUrl:    window.ARC.explorer + '/tx/' + fundTxHash
    });
    localStorage.setItem('rh_orders', JSON.stringify(savedOrders));

    localStorage.removeItem('cart');
    try { CartStore._syncBadge([]); } catch (e) {}

    setBtn('Funds locked! Redirecting\u2026');
    showToast('\u2713 Funds locked in escrow! Order ' + orderId, 'success');
    setTimeout(() => { window.location.href = '/orders/' + orderId; }, 1200);
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  ARC COMMERCE \u2014 USDC Balance Panel + Status Hook
  //  Non-destructive: only adds UI, does NOT change confirmOrder flow
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  /**
   * initArcPaymentUI \u2014 shows USDC balance and Arc Commerce badge.
   * Called once after wallet is confirmed on DOMContentLoaded.
   * Never throws \u2014 all errors are silent (panel stays hidden).
   */
  async function initArcPaymentUI(wallet) {
    const panel = document.getElementById('arc-payment-status');
    if (!panel) return;

    try {
      // Wait for arcPayments.js to load (defer may not have fired yet)
      if (typeof window.ArcPayments === 'undefined') {
        await new Promise(resolve => {
          let tries = 0;
          const id = setInterval(() => {
            tries++;
            if (window.ArcPayments || tries > 20) { clearInterval(id); resolve(); }
          }, 150);
        });
      }

      if (!window.ArcPayments) return; // script failed to load \u2014 silent

      // Show loading state
      panel.className = 'mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800';
      panel.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Checking USDC balance via Arc Network\u2026';
      panel.classList.remove('hidden');

      if (!wallet || !wallet.address) {
        panel.className = 'mt-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500 hidden';
        return;
      }

      // Get USDC balance (non-blocking \u2014 5s timeout)
      const balResult = await Promise.race([
        window.ArcPayments.getBalance(wallet.address, 'USDC'),
        new Promise(r => setTimeout(() => r({ ok: false, balance: '?' }), 5000))
      ]);

      const isAvailable = window.ArcPayments.isAvailable();
      const balFormatted = balResult.ok ? parseFloat(balResult.balance).toFixed(2) : '\u2014';

      // Get cart total for balance check
      const cart = getCart();
      const total = cart.reduce((s, i) => s + (parseFloat(i.price)||0) * ((i.quantity||i.qty)||1), 0);
      const totalWithFee = total + total * 0.015;
      const hasSufficientBalance = balResult.ok && parseFloat(balResult.balance) >= totalWithFee;

      if (isAvailable) {
        panel.className = 'mt-3 p-3 rounded-lg border border-green-200 bg-green-50 text-xs text-green-800';
        panel.innerHTML =
          '<div class="flex items-center gap-2 mb-1">'
          + '<span class="inline-flex items-center gap-1 bg-blue-700 text-white px-2 py-0.5 rounded-full text-xs font-semibold">'
          + '<i class="fas fa-circle text-blue-300" style="font-size:7px"></i> Arc Commerce</span>'
          + '<span class="font-semibold">USDC Payment Ready</span>'
          + '</div>'
          + '<div class="flex items-center justify-between">'
          + '<span>Your USDC balance: <strong>' + balFormatted + ' USDC</strong></span>'
          + (hasSufficientBalance
              ? '<span class="text-green-700 font-semibold"><i class="fas fa-check-circle mr-1"></i>Sufficient</span>'
              : '<a href="https://faucet.circle.com" target="_blank" class="text-orange-700 font-semibold underline"><i class="fas fa-exclamation-circle mr-1"></i>Get USDC</a>'
            )
          + '</div>'
          + '<p class="mt-1 text-green-700 opacity-75">Powered by Circle \xB7 Arc Testnet (Chain ID 5042002)</p>';
      } else {
        panel.className = 'mt-3 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-500';
        panel.innerHTML =
          '<i class="fas fa-info-circle mr-1"></i> Arc Commerce: escrow contract not configured. '
          + 'USDC balance: <strong>' + balFormatted + ' USDC</strong>';
      }
    } catch (e) {
      // Silent fail \u2014 never disrupt checkout
      console.warn('[Arc Commerce UI]', e.message);
    }
  }

  /**
   * updateArcPaymentStatus \u2014 updates the panel during confirmOrder steps.
   * Called by the ArcPayments onStatus hook (non-destructive).
   */
  function updateArcPaymentStatus(step, message) {
    const panel = document.getElementById('arc-payment-status');
    if (!panel) return;
    panel.className = 'mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50 text-xs text-blue-800';
    panel.classList.remove('hidden');
    const icons = {
      validate:    'fas fa-check-circle',
      network:     'fas fa-wifi',
      signer:      'fas fa-key',
      approve:     'fas fa-stamp',
      createEscrow:'fas fa-lock',
      fundEscrow:  'fas fa-coins',
      complete:    'fas fa-check-double',
    };
    const icon = icons[step] || 'fas fa-circle-notch fa-spin';
    panel.innerHTML =
      '<span class="inline-flex items-center gap-1 bg-blue-700 text-white px-2 py-0.5 rounded-full text-xs font-semibold mr-2">'
      + '<i class="fas fa-circle text-blue-300" style="font-size:7px"></i> Arc Commerce</span>'
      + '<i class="' + icon + ' mr-1"></i>' + message;
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  PAY WITHOUT WALLET \u2014 QR Code + on-chain polling
  //  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //  \u2022 Only shown when user has NO wallet connected
  //  \u2022 Does NOT alter any existing button or flow
  //  \u2022 Generates EIP-681 URI \u2192 QR Code via qrcode.js CDN
  //  \u2022 Polls /api/payment/poll/:sid every 5s
  //  \u2022 On confirmation \u2192 saves order to localStorage \u2192 redirects
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  let _qrSession = null;       // current active session
  let _qrPollTimer = null;     // setInterval handle
  let _qrLibReady = false;     // QRCode.js loaded flag

  // Load QRCode.js lazily (only when needed, no impact on normal flow)
  function loadQRLib(cb) {
    if (typeof QRCode !== 'undefined') { cb(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => { _qrLibReady = true; cb(); };
    s.onerror = () => cb(); // fail silently
    document.head.appendChild(s);
  }

  // Render the "Pay without wallet" section into #co-no-wallet-section
  function renderNoWalletPayOption(subtotal, fee, currency) {
    const section = document.getElementById('co-no-wallet-section');
    if (!section) return;
    section.classList.remove('hidden');
    section.innerHTML = \`
      <div style="border:2px dashed #e2e8f0;border-radius:14px;overflow:hidden;">
        <!-- Header toggle -->
        <button onclick="toggleNoWalletPanel()" id="nwp-toggle"
          style="width:100%;background:#f8fafc;border:none;cursor:pointer;padding:14px 16px;
                 display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:36px;height:36px;border-radius:10px;
                        background:linear-gradient(135deg,#6366f1,#4f46e5);
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-qrcode" style="color:#fff;font-size:.85rem;"></i>
            </div>
            <div style="text-align:left;">
              <p style="font-weight:700;color:#1e293b;font-size:.85rem;margin:0;">
                Pay without wallet
              </p>
              <p style="color:#64748b;font-size:.72rem;margin:0;">
                Scan QR code or copy address &amp; send manually
              </p>
            </div>
          </div>
          <i id="nwp-chevron" class="fas fa-chevron-down" style="color:#94a3b8;transition:transform .2s;"></i>
        </button>

        <!-- Collapsible body -->
        <div id="nwp-body" style="display:none;padding:16px;background:#fff;">
          <!-- Token selector (mirrors checkout radio group) -->
          <div style="margin-bottom:12px;">
            <p style="font-size:.75rem;font-weight:600;color:#64748b;margin:0 0 8px;
                      text-transform:uppercase;letter-spacing:.05em;">Payment Token</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <label style="cursor:pointer;">
                <input type="radio" name="nwp-token" value="USDC" checked class="sr-only" onchange="nwpTokenChanged()"/>
                <div id="nwp-tok-usdc"
                  style="padding:10px;border:2px solid #dc2626;border-radius:10px;
                         background:#fff1f1;display:flex;align-items:center;gap:8px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;
                               display:flex;align-items:center;justify-content:center;">
                    <span style="font-weight:800;color:#1d4ed8;font-size:.85rem;">$</span></div>
                  <div><p style="font-weight:700;color:#1e293b;font-size:.8rem;margin:0;">USDC</p>
                       <p style="color:#94a3b8;font-size:.65rem;margin:0;">Native on Arc</p></div>
                </div>
              </label>
              <label style="cursor:pointer;">
                <input type="radio" name="nwp-token" value="EURC" class="sr-only" onchange="nwpTokenChanged()"/>
                <div id="nwp-tok-eurc"
                  style="padding:10px;border:2px solid #e2e8f0;border-radius:10px;
                         background:#fff;display:flex;align-items:center;gap:8px;">
                  <div style="width:32px;height:32px;border-radius:50%;background:#e0e7ff;
                               display:flex;align-items:center;justify-content:center;">
                    <span style="font-weight:800;color:#4338ca;font-size:.85rem;">\u20AC</span></div>
                  <div><p style="font-weight:700;color:#1e293b;font-size:.8rem;margin:0;">EURC</p>
                       <p style="color:#94a3b8;font-size:.65rem;margin:0;">Euro stablecoin</p></div>
                </div>
              </label>
            </div>
          </div>

          <!-- Sender wallet address (optional) -->
          <div style="margin-bottom:12px;">
            <label for="nwp-sender-addr"
              style="display:block;font-size:.75rem;font-weight:600;color:#64748b;
                     margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em;">
              <i class="fas fa-paper-plane" style="color:#6366f1;"></i>
              Sender Wallet Address
              <span style="font-weight:400;color:#94a3b8;text-transform:none;letter-spacing:0;
                           font-size:.7rem;"> (Optional)</span>
            </label>
            <input
              type="text"
              id="nwp-sender-addr"
              placeholder="0x..."
              oninput="nwpValidateSender(this)"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
              style="width:100%;border:1.5px solid #e2e8f0;border-radius:8px;
                     padding:9px 12px;font-size:.8rem;font-family:monospace;
                     outline:none;transition:border-color .2s;background:#fafafa;
                     color:#1e293b;"
            />
            <p id="nwp-sender-err"
              style="display:none;color:#dc2626;font-size:.7rem;margin:3px 0 0;
                     font-weight:600;">
              <i class="fas fa-times-circle"></i> Invalid wallet address
            </p>
            <p style="color:#94a3b8;font-size:.68rem;margin:4px 0 0;line-height:1.4;">
              Optional: enter the wallet that will send the payment so the system can
              identify your transaction faster.
            </p>
          </div>

          <!-- Generate button -->
          <button onclick="generateQRPayment()"
            id="nwp-gen-btn"
            style="width:100%;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;
                   border:none;padding:11px 16px;border-radius:9px;font-weight:700;
                   font-size:.85rem;cursor:pointer;display:flex;align-items:center;
                   justify-content:center;gap:8px;transition:opacity .2s;">
            <i class="fas fa-qrcode"></i> Generate Payment QR Code
          </button>

          <!-- QR + payment info area (hidden until generated) -->
          <div id="nwp-payment-area" style="display:none;margin-top:14px;">

            <!-- Amount badge -->
            <div id="nwp-amount-badge"
              style="text-align:center;background:#f0fdf4;border:1px solid #86efac;
                     border-radius:10px;padding:10px 14px;margin-bottom:12px;">
              <p style="font-size:.7rem;color:#16a34a;font-weight:600;margin:0 0 2px;
                        text-transform:uppercase;letter-spacing:.06em;">Exact amount to send</p>
              <p id="nwp-amount-text"
                style="font-size:1.5rem;font-weight:900;color:#15803d;margin:0;"></p>
            </div>

            <!-- QR Code canvas -->
            <div style="display:flex;justify-content:center;margin-bottom:12px;">
              <div id="nwp-qr-wrap"
                style="padding:12px;background:#fff;border:1px solid #e2e8f0;
                       border-radius:12px;display:inline-block;">
                <canvas id="nwp-qr-canvas"></canvas>
              </div>
            </div>

            <!-- Escrow address + copy -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:10px 12px;margin-bottom:8px;">
              <p style="font-size:.7rem;font-weight:600;color:#94a3b8;margin:0 0 4px;
                        text-transform:uppercase;letter-spacing:.05em;">
                <i class="fas fa-file-contract"></i> Escrow Contract (send here)
              </p>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <code id="nwp-escrow-addr"
                  style="font-size:.72rem;color:#1e293b;font-family:monospace;
                         flex:1;word-break:break-all;"></code>
                <button onclick="nwpCopyAddress()"
                  id="nwp-copy-btn"
                  style="background:#1e293b;color:#fff;border:none;padding:5px 12px;
                         border-radius:7px;font-size:.72rem;font-weight:600;cursor:pointer;
                         white-space:nowrap;flex-shrink:0;display:flex;align-items:center;gap:5px;">
                  <i class="fas fa-copy"></i> Copy Address
                </button>
              </div>
            </div>

            <!-- Token contract address -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:8px 12px;margin-bottom:12px;">
              <p style="font-size:.7rem;font-weight:600;color:#94a3b8;margin:0 0 3px;
                        text-transform:uppercase;letter-spacing:.05em;">
                <i class="fas fa-coins"></i> Token Contract
              </p>
              <code id="nwp-token-addr"
                style="font-size:.68rem;color:#475569;font-family:monospace;word-break:break-all;"></code>
            </div>

            <!-- Instructions -->
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;
                        padding:10px 12px;margin-bottom:12px;">
              <p style="font-size:.78rem;font-weight:700;color:#92400e;margin:0 0 4px;">
                <i class="fas fa-exclamation-triangle"></i> Instructions
              </p>
              <ol style="margin:0;padding-left:16px;color:#78350f;font-size:.72rem;line-height:1.7;">
                <li>Open your wallet app (MetaMask, Trust Wallet, etc.)</li>
                <li>Switch to <strong>Arc Testnet</strong> (Chain ID: 5042002)</li>
                <li>Send <strong id="nwp-instr-amount"></strong> to the escrow address above</li>
                <li>This page will detect the payment automatically</li>
              </ol>
            </div>

            <!-- Polling status -->
            <div id="nwp-poll-status"
              style="border-radius:10px;padding:12px 14px;
                     background:#eff6ff;border:1px solid #bfdbfe;
                     display:flex;align-items:center;gap:10px;">
              <div class="loading-spinner" style="flex-shrink:0;"></div>
              <div>
                <p style="font-weight:700;color:#1e40af;font-size:.8rem;margin:0;">
                  Waiting for payment confirmation\u2026
                </p>
                <p id="nwp-poll-sub"
                  style="color:#3b82f6;font-size:.7rem;margin:2px 0 0;">
                  Checking Arc Network every 5 seconds
                </p>
              </div>
            </div>

            <!-- Expiry timer -->
            <p id="nwp-expiry-text"
              style="text-align:center;font-size:.68rem;color:#94a3b8;margin:8px 0 0;"></p>

          </div><!-- /nwp-payment-area -->
        </div><!-- /nwp-body -->
      </div>
    \`;
    // store values for use in handlers
    window._nwpSubtotal = subtotal;
    window._nwpFee      = fee;
    window._nwpCurrency = currency;
  }

  function toggleNoWalletPanel() {
    const body    = document.getElementById('nwp-body');
    const chevron = document.getElementById('nwp-chevron');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display    = open ? 'none' : 'block';
    if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  }

  function nwpTokenChanged() {
    const usdc = document.querySelector('input[name="nwp-token"][value="USDC"]');
    const eurc = document.querySelector('input[name="nwp-token"][value="EURC"]');
    const boxU = document.getElementById('nwp-tok-usdc');
    const boxE = document.getElementById('nwp-tok-eurc');
    if (!usdc || !eurc || !boxU || !boxE) return;
    boxU.style.border    = usdc.checked ? '2px solid #dc2626' : '2px solid #e2e8f0';
    boxU.style.background= usdc.checked ? '#fff1f1' : '#fff';
    boxE.style.border    = eurc.checked ? '2px solid #dc2626' : '2px solid #e2e8f0';
    boxE.style.background= eurc.checked ? '#fff1f1' : '#fff';
    // Reset payment area so user must re-generate
    const area = document.getElementById('nwp-payment-area');
    if (area) area.style.display = 'none';
    nwpStopPolling();
    _qrSession = null;
  }

  async function generateQRPayment() {
    const btn = document.getElementById('nwp-gen-btn');
    if (btn) { btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2" style="width:14px;height:14px;border-width:2px;"></span>Generating\u2026'; }

    nwpStopPolling();
    _qrSession = null;

    const cart = getCart();
    if (!cart.length) {
      showToast('Cart is empty', 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    const tokenEl = document.querySelector('input[name="nwp-token"]:checked');
    const token   = tokenEl ? tokenEl.value : 'USDC';

    // Resolve seller from first cart item
    let sellerAddress = null;
    try {
      const pid = cart[0]?.id;
      if (pid) {
        const r = await fetch('/api/products/' + pid);
        const d = await r.json();
        if (d.product?.seller_id && d.product.seller_id.startsWith('0x'))
          sellerAddress = d.product.seller_id;
      }
    } catch(e) { console.warn('[nwp] seller fetch:', e); }

    if (!sellerAddress) {
      showToast('Could not resolve seller address', 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    try {
      const res  = await fetch('/api/payment/qr-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart, token, sellerAddress })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'API error');
      _qrSession = data;
    } catch(err) {
      showToast('Failed to create payment session: ' + err.message, 'error');
      if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-qrcode"></i> Generate Payment QR Code'; }
      return;
    }

    // Populate UI
    const amountText = _qrSession.amount.toFixed(2) + ' ' + token;
    document.getElementById('nwp-amount-text').textContent  = amountText;
    document.getElementById('nwp-instr-amount').textContent = amountText;
    document.getElementById('nwp-escrow-addr').textContent  = _qrSession.escrowAddress;
    document.getElementById('nwp-token-addr').textContent   = _qrSession.tokenAddress;

    // Expiry countdown
    nwpUpdateExpiry();

    // Show payment area
    document.getElementById('nwp-payment-area').style.display = 'block';

    // Render QR
    loadQRLib(() => {
      const canvas = document.getElementById('nwp-qr-canvas');
      if (!canvas || typeof QRCode === 'undefined') return;
      try {
        QRCode.toCanvas(canvas, _qrSession.paymentUri, {
          width: 200, margin: 1,
          color: { dark: '#1e293b', light: '#ffffff' }
        }, err => { if (err) console.warn('[nwp] QR error:', err); });
      } catch(e) { console.warn('[nwp] QR generate:', e); }
    });

    if (btn) { btn.disabled=false; btn.innerHTML='<i class="fas fa-sync-alt"></i> Regenerate'; }

    // Start polling
    nwpStartPolling();
  }

  function nwpCopyAddress() {
    if (!_qrSession) return;
    const addr = _qrSession.escrowAddress;
    try {
      navigator.clipboard.writeText(addr).then(() => {
        const btn = document.getElementById('nwp-copy-btn');
        if (btn) { btn.innerHTML='<i class="fas fa-check"></i> Copied!'; btn.style.background='#16a34a'; }
        showToast('Escrow address copied!', 'success');
        setTimeout(() => {
          const b = document.getElementById('nwp-copy-btn');
          if (b) { b.innerHTML='<i class="fas fa-copy"></i> Copy Address'; b.style.background='#1e293b'; }
        }, 2500);
      });
    } catch(e) {
      // Fallback for non-HTTPS or browser restrictions
      const ta = document.createElement('textarea');
      ta.value = addr; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Address copied!', 'success');
    }
  }

  function nwpValidateSender(input) {
    const errEl = document.getElementById('nwp-sender-err');
    const val   = (input.value || '').trim();
    if (val === '') {
      // Empty is valid (optional field)
      input.style.borderColor = '#e2e8f0';
      if (errEl) errEl.style.display = 'none';
      return true;
    }
    const isValid = /^0x[0-9a-fA-F]{40}$/.test(val);
    input.style.borderColor = isValid ? '#16a34a' : '#dc2626';
    if (errEl) errEl.style.display = isValid ? 'none' : 'block';
    return isValid;
  }

  function nwpUpdateExpiry() {
    if (!_qrSession) return;
    const el = document.getElementById('nwp-expiry-text');
    if (!el) return;
    const left = Math.max(0, Math.floor((_qrSession.expiresAt - Date.now()) / 1000));
    const min  = Math.floor(left / 60);
    const sec  = left % 60;
    el.textContent = left > 0
      ? '\u23F1 Payment window: ' + min + 'm ' + (sec < 10 ? '0' : '') + sec + 's'
      : '\u26A0 Session expired \u2014 please regenerate';
    if (left <= 0) { nwpStopPolling(); }
  }

  function nwpStartPolling() {
    nwpStopPolling();
    let pollCount = 0;
    _qrPollTimer = setInterval(async () => {
      if (!_qrSession) { nwpStopPolling(); return; }
      if (_qrSession.expiresAt < Date.now()) {
        nwpStopPolling();
        nwpSetPollStatus('expired', 'Session expired. Please generate a new QR code.', '#fee2e2', '#fca5a5', '#dc2626');
        return;
      }
      pollCount++;
      nwpUpdateExpiry();
      try {
        // Append sender address as ?from= if user provided a valid one
        const senderInput = document.getElementById('nwp-sender-addr');
        const senderVal   = (senderInput ? senderInput.value.trim() : '');
        const senderValid = senderVal !== '' && /^0x[0-9a-fA-F]{40}$/.test(senderVal);
        const pollUrl     = '/api/payment/poll/' + _qrSession.sid
          + (senderValid ? '?from=' + senderVal.toLowerCase() : '');
        const res  = await fetch(pollUrl);
        const data = await res.json();

        if (data.status === 'confirmed') {
          nwpStopPolling();
          nwpOnPaymentConfirmed(data);
          return;
        }
        if (data.status === 'expired') {
          nwpStopPolling();
          nwpSetPollStatus('expired', 'Session expired. Please generate a new QR code.', '#fee2e2', '#fca5a5', '#dc2626');
          return;
        }
        // pending \u2014 update subtitle
        const sub = document.getElementById('nwp-poll-sub');
        if (sub) sub.textContent = 'Check #' + pollCount + ' \u2014 no payment yet. Retrying in 5s\u2026';
      } catch(e) {
        console.warn('[nwp] poll error:', e);
      }
    }, 5000);
  }

  function nwpStopPolling() {
    if (_qrPollTimer) { clearInterval(_qrPollTimer); _qrPollTimer = null; }
  }

  function nwpSetPollStatus(state, msg, bg, border, color) {
    const el = document.getElementById('nwp-poll-status');
    if (!el) return;
    const icons = { confirmed:'fas fa-check-circle', expired:'fas fa-times-circle', error:'fas fa-exclamation-circle' };
    const icon  = icons[state] || 'fas fa-circle-notch fa-spin';
    el.style.background = bg; el.style.borderColor = border;
    el.innerHTML = '<i class="' + icon + '" style="font-size:1.3rem;color:' + color + ';flex-shrink:0;"></i>'
      + '<div><p style="font-weight:700;color:' + color + ';font-size:.8rem;margin:0;">' + msg + '</p></div>';
  }

  function nwpOnPaymentConfirmed(data) {
    // Update UI to "confirmed" state
    nwpSetPollStatus('confirmed',
      'Payment detected on Arc Network!',
      '#f0fdf4', '#86efac', '#16a34a'
    );

    // Save order to localStorage (same structure as normal checkout)
    const cart = getCart();
    const tokenEl = document.querySelector('input[name="nwp-token"]:checked');
    const token   = _qrSession?.token || (tokenEl ? tokenEl.value : 'USDC');
    const orderId = _qrSession?.orderId || ('ORD-' + Date.now());

    const order = {
      id:             orderId,
      txHash:         data.txHash,
      fundTxHash:     data.txHash,
      buyerAddress:   'MANUAL_TRANSFER',
      sellerAddress:  _qrSession?.sellerAddress || '',
      escrowContract: _qrSession?.escrowAddress || '',
      amount:         _qrSession?.amount || 0,
      token:          token,
      productId:      cart[0]?.id || '',
      items:          cart,
      status:         'FUNDED',
      paymentMethod:  'qr_no_wallet',
      createdAt:      new Date().toISOString(),
      explorerUrl:    (window.ARC?.explorer || 'https://testnet.arcscan.app') + '/tx/' + data.txHash
    };

    const saved = JSON.parse(localStorage.getItem('rh_orders') || '[]');
    saved.unshift(order);
    localStorage.setItem('rh_orders', JSON.stringify(saved));

    // Best-effort backend save
    try {
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...order,
          orderId32: null,
          buyerAddress: order.buyerAddress
        })
      }).catch(() => {});
    } catch(_) {}

    localStorage.removeItem('cart');
    try { CartStore._syncBadge([]); } catch(_) {}

    showToast('\u2713 Payment confirmed! Redirecting\u2026', 'success');
    setTimeout(() => { window.location.href = '/orders/' + orderId; }, 1500);
  }
  </script>
  `);
}
function walletPage() {
  return shell("Wallet", `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-wallet text-red-500"></i> Shukly Store Wallet
    </h1>
    <p class="text-slate-500 mb-2">Non-custodial wallet \u2014 your keys, your funds, on Arc Network.</p>
    <div id="wallet-network-status" class="mb-6"></div>

    <!-- Unlock Wallet (shown when encrypted wallet exists but session not active) -->
    <div id="unlock-wallet-state" class="hidden">
      <div class="max-w-md mx-auto">
        <div class="card p-8 text-center mb-4">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-lg">
            <i class="fas fa-lock"></i>
          </div>
          <h2 class="text-2xl font-bold text-slate-800 mb-2">Unlock Your Wallet</h2>
          <p class="text-slate-500 text-sm mb-6">Your encrypted wallet is stored locally. Enter your password to access it.</p>
          <div class="space-y-4 text-left">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Wallet Password</label>
              <input id="unlock-password" type="password" placeholder="Enter your wallet password" class="input"
                onkeydown="if(event.key==='Enter')unlockWalletUI()"/>
            </div>
            <div id="unlock-error" class="hidden p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <i class="fas fa-exclamation-circle mr-1"></i> Senha incorreta. Tente novamente.
            </div>
            <button onclick="unlockWalletUI()" id="unlock-btn" class="btn-primary w-full justify-center py-3">
              <i class="fas fa-unlock"></i> Unlock Wallet
            </button>
          </div>
        </div>
        <div class="text-center">
          <p class="text-slate-400 text-xs mb-2">Forgot your password?</p>
          <button onclick="showForgotPasswordUI()" class="text-red-500 text-sm hover:underline font-medium">
            <i class="fas fa-key mr-1"></i> Reset with Seed Phrase
          </button>
        </div>
        <!-- Forgot password panel (hidden by default) -->
        <div id="forgot-password-panel" class="hidden card p-6 mt-4">
          <h3 class="font-bold text-slate-800 mb-3 flex items-center gap-2">
            <i class="fas fa-key text-amber-500"></i> Reset Wallet Password
          </h3>
          <p class="text-slate-500 text-sm mb-4">Import your wallet again using your seed phrase to set a new password.</p>
          <button onclick="showToast('Use MetaMask or WalletConnect to connect your wallet.','info')" class="btn-primary w-full justify-center mb-3">
            <i class="fas fa-wallet"></i> Connect External Wallet
          </button>
          <button onclick="confirmResetWallet()" class="w-full text-center text-red-500 text-sm hover:underline py-2">
            <i class="fas fa-trash-alt mr-1"></i> Delete stored wallet data
          </button>
        </div>
      </div>
    </div>

    <!-- No Wallet -->
    <div id="no-wallet-state">

      <div class="card p-6">
        <h3 class="font-bold text-slate-800 mb-4">Connect External Wallet</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button onclick="connectAndReload('metamask')" class="card p-4 flex items-center gap-3 hover:border-orange-300 hover:bg-orange-50/50 transition-all">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-10 h-10"/>
            <div class="text-left">
              <p class="font-bold text-slate-800">MetaMask</p>
              <p class="text-slate-400 text-xs">Auto-switches to Arc Testnet</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
          <button onclick="showToast('WalletConnect: scan QR with wallet set to Arc Testnet (5042002)','info')" class="card p-4 flex items-center gap-3 hover:border-blue-300 hover:bg-blue-50/50 transition-all">
            <div class="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
              <i class="fas fa-qrcode text-white"></i>
            </div>
            <div class="text-left">
              <p class="font-bold text-slate-800">WalletConnect</p>
              <p class="text-slate-400 text-xs">Chain ID: 5042002</p>
            </div>
            <i class="fas fa-chevron-right text-slate-300 ml-auto"></i>
          </button>
        </div>
        <div class="mt-4 p-3 bg-blue-50 rounded-xl text-xs text-blue-800">
          <i class="fas fa-info-circle mr-1"></i>
          <strong>New to Arc?</strong> Get free test USDC & EURC at
          <a href="https://faucet.circle.com" target="_blank" class="underline font-bold">faucet.circle.com</a>
        </div>
        <!-- Wallet transparency notice -->
        <div class="trust-box mt-4">
          <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0;margin-top:1px"></i>
          <span><strong>Your keys, your funds.</strong> Shukly Store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets.</span>
        </div>
      </div>
    </div>

    <!-- Has Wallet -->
    <div id="has-wallet-state" class="hidden">
      <!-- Wallet card -->
      <div class="wallet-card mb-6">
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
            </div>
            <div>
              <p class="font-bold text-lg">Shukly Store Wallet</p>
              <p class="text-red-200 text-xs">Arc Testnet \xB7 Chain 5042002</p>
            </div>
          </div>
          <div class="text-right">
            <div id="network-dot" class="w-3 h-3 rounded-full bg-yellow-400 ml-auto animate-pulse"></div>
            <p class="text-red-200 text-xs mt-1" id="wallet-network-label">Checking\u2026</p>
          </div>
        </div>
        <div class="mb-4">
          <p class="text-red-200 text-xs mb-1">Wallet Address</p>
          <div class="flex items-center gap-2">
            <p class="font-mono text-sm break-all" id="wallet-addr-display">\u2014</p>
            <button onclick="copyAddress()" class="text-red-200 hover:text-white text-xs shrink-0"><i class="fas fa-copy"></i></button>
          </div>
          <a id="explorer-link" href="#" target="_blank" class="text-red-300 text-xs hover:text-white mt-1 inline-flex items-center gap-1">
            <i class="fas fa-external-link-alt text-xs"></i> View on Arc Explorer
          </a>
        </div>
        <!-- Balances \u2014 fetched live from Arc RPC -->
        <div class="grid grid-cols-2 gap-4">
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">USDC Balance</p>
            <div id="usdc-balance-display" class="flex items-center gap-2">
              <div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>
            </div>
            <p class="text-red-300 text-xs mt-1">Native on Arc</p>
          </div>
          <div class="bg-white/10 rounded-xl p-4">
            <p class="text-red-200 text-xs mb-1">EURC Balance</p>
            <div id="eurc-balance-display" class="flex items-center gap-2">
              <div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>
            </div>
            <p class="text-red-300 text-xs mt-1">0x89B5\u2026D72a</p>
          </div>
        </div>
        <button onclick="refreshBalances()" class="mt-3 text-red-200 hover:text-white text-xs flex items-center gap-1">
          <i class="fas fa-sync-alt text-xs"></i> Refresh balances
        </button>
      </div>

      <!-- Actions -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        ${[["fas fa-paper-plane", "Send", "openSendModal()"], ["fas fa-qrcode", "Receive", "openReceiveModal()"], ["fas fa-external-link-alt", "Explorer", "openExplorer()"], ["fas fa-history", "Orders", "window.location.href=&quot;/orders&quot;"]].map(([icon, label, action]) => `
          <button onclick="${action}" class="card p-4 flex flex-col items-center gap-2 hover:border-red-300 hover:bg-red-50 transition-all">
            <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600"><i class="${icon}"></i></div>
            <p class="text-sm font-semibold text-slate-700">${label}</p>
          </button>`).join("")}
      </div>

      <!-- Wallet transparency notice (dashboard) -->
      <div class="trust-box mb-6">
        <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0;margin-top:1px"></i>
        <span><strong>Your keys, your funds.</strong> Shukly Store never accesses your private keys. All transactions are signed locally in your wallet and broadcast directly to Arc Network. We have zero custody over your assets. <a href="/privacy" class="underline text-green-800 font-medium">Privacy Policy</a></span>
      </div>

      <!-- Real Tx History -->
      <div class="card p-5 mb-4">
        <h3 class="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <i class="fas fa-history text-red-500"></i> Transaction History
          <span class="text-xs text-slate-400 font-normal ml-auto">Live from Arc Explorer</span>
        </h3>
        <div id="tx-history-container">
          <div class="text-center py-6">
            <div class="loading-spinner mx-auto mb-2"></div>
            <p class="text-slate-400 text-sm">Fetching from Arc Network\u2026</p>
          </div>
        </div>
      </div>

      <div class="card p-5 border-red-100">
        <div class="flex flex-wrap gap-3">
          <button onclick="disconnectWallet()" class="bg-red-50 text-red-600 border-2 border-red-200 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-100">
            <i class="fas fa-sign-out-alt"></i> Disconnect
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Send Modal -->
  <div id="send-modal" class="modal-overlay hidden">
    <div class="modal">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-bold text-slate-800"><i class="fas fa-paper-plane text-red-500 mr-2"></i>Send Tokens</h3>
        <button onclick="closeSendModal()" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times text-xl"></i></button>
      </div>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Recipient Address (Arc Testnet)</label>
          <input type="text" id="send-to" placeholder="0x\u2026" class="input"/>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Token</label>
          <select id="send-token" class="select">
            <option value="USDC">USDC (native)</option>
            <option value="EURC">EURC (ERC-20)</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 mb-1">Amount</label>
          <input type="number" id="send-amount" placeholder="0.00" step="0.000001" class="input"/>
        </div>
        <div class="network-warning text-xs">
          <i class="fas fa-exclamation-triangle"></i>
          Transactions on Arc Network are irreversible. You need USDC for gas fees.
        </div>
        <button onclick="executeSend()" class="btn-primary w-full justify-center py-3">
          <i class="fas fa-paper-plane"></i> Send on Arc Network
        </button>
      </div>
    </div>
  </div>

  <!-- Receive Modal -->
  <div id="receive-modal" class="modal-overlay hidden">
    <div class="modal text-center">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-bold text-slate-800"><i class="fas fa-qrcode text-red-500 mr-2"></i>Receive Tokens</h3>
        <button onclick="closeReceiveModal()" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times text-xl"></i></button>
      </div>
      <div class="bg-slate-50 rounded-2xl p-6 mb-4 inline-block">
        <div class="w-48 h-48 flex items-center justify-center bg-white rounded-xl mx-auto border border-slate-200">
          <i class="fas fa-qrcode text-7xl text-slate-300"></i>
        </div>
      </div>
      <p class="font-medium text-slate-800 mb-1">Your Arc Network Address</p>
      <div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 mb-3 justify-center">
        <p class="font-mono text-xs text-slate-600 break-all" id="receive-addr">\u2014</p>
        <button onclick="copyAddress()" class="text-red-500 shrink-0"><i class="fas fa-copy text-sm"></i></button>
      </div>
      <p class="text-slate-400 text-xs mb-3">Send only USDC or EURC on <strong>Arc Testnet (Chain ID: 5042002)</strong>.</p>
      <a href="https://faucet.circle.com" target="_blank" class="btn-primary text-sm mx-auto">
        <i class="fas fa-faucet"></i> Get Free Test Tokens
      </a>
    </div>
  </div>

  <script>
  async function connectAndReload(type) {
    const w = await connectWallet(type);
    if (w) setTimeout(() => location.reload(), 800);
  }

  async function refreshBalances() {
    const w = getStoredWallet();
    if (!w) return;
    document.getElementById('usdc-balance-display').innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>';
    document.getElementById('eurc-balance-display').innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:1.5px"></div>';
    const b = await fetchArcBalances(w.address);
    document.getElementById('usdc-balance-display').innerHTML =
      '<p class="text-2xl font-bold">' + b.usdc + '</p>';
    document.getElementById('eurc-balance-display').innerHTML =
      '<p class="text-2xl font-bold">' + b.eurc + '</p>';
    if (b.error) showToast('Balance fetch: ' + b.error, 'warning');
  }

  async function loadTxHistory(address) {
    const container = document.getElementById('tx-history-container');
    try {
      // Try Arc Explorer API
      const txs = await fetchTxHistory(address, 10);
      if (!txs.length) {
        // Fallback: show local orders
        const orders = JSON.parse(localStorage.getItem('rh_orders') || '[]');
        if (!orders.length) {
          container.innerHTML = '<div class="empty-state" style="padding:24px"><i class="fas fa-receipt" style="font-size:24px;margin-bottom:8px"></i><p class="text-sm">No transactions yet</p><a href="https://faucet.circle.com" target="_blank" class="text-red-600 text-xs hover:underline mt-1 block">Get test tokens to start \u2192</a></div>';
          return;
        }
        container.innerHTML = orders.slice(-5).reverse().map(o =>
          '<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">'
          + '<div class="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-shopping-bag text-sm"></i></div>'
          + '<div class="flex-1"><p class="font-medium text-sm text-slate-800">Escrow \u2014 ' + o.id + '</p>'
          + '<p class="text-xs text-slate-400 addr-mono">' + (o.txHash||'').substring(0,24) + '\u2026</p></div>'
          + '<div class="text-right"><p class="font-bold text-red-600 text-sm">-' + (o.total||0).toFixed(2) + ' USDC</p>'
          + (o.explorerUrl ? '<a href="' + o.explorerUrl + '" target="_blank" class="text-blue-500 text-xs hover:underline">Explorer \u2197</a>' : '')
          + '</div></div>'
        ).join('');
        return;
      }
      // Real transactions from Arc Explorer
      container.innerHTML = txs.map(tx =>
        '<div class="flex items-center gap-3 py-3 border-b border-slate-50 last:border-0">'
        + '<div class="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600"><i class="fas fa-exchange-alt text-sm"></i></div>'
        + '<div class="flex-1"><p class="font-medium text-sm text-slate-800">' + (tx.method||'Transfer') + '</p>'
        + '<p class="text-xs text-slate-400 addr-mono">' + (tx.hash||'').substring(0,24) + '\u2026</p></div>'
        + '<div class="text-right">'
        + '<a href="' + ARC.explorer + '/tx/' + tx.hash + '" target="_blank" class="text-blue-500 text-xs hover:underline">View \u2197</a></div></div>'
      ).join('');
    } catch {
      container.innerHTML = '<div class="text-center py-4 text-slate-400 text-sm">Could not fetch transaction history from Arc Explorer.</div>';
    }
  }

  function copyAddress() {
    const w = getStoredWallet();
    if (!w) return;
    navigator.clipboard.writeText(w.address).then(() => showToast('Address copied!', 'success'));
  }
  function openExplorer() {
    const w = getStoredWallet();
    if (w) window.open(ARC.explorer + '/address/' + w.address, '_blank');
  }
  function openSendModal() { document.getElementById('send-modal').classList.remove('hidden'); }
  function closeSendModal() { document.getElementById('send-modal').classList.add('hidden'); }
  function openReceiveModal() { document.getElementById('receive-modal').classList.remove('hidden'); }
  function closeReceiveModal() { document.getElementById('receive-modal').classList.add('hidden'); }

  async function executeSend() {
    const to = document.getElementById('send-to').value.trim();
    const amount = document.getElementById('send-amount').value;
    const token = document.getElementById('send-token').value;
    if (!to || !amount) { showToast('Fill all fields', 'error'); return; }
    if (!to.startsWith('0x') || to.length !== 42) { showToast('Invalid Arc address', 'error'); return; }
    const w = getStoredWallet();
    if (!w) { showToast('Connect wallet first', 'error'); return; }
    if (w.type === 'metamask' && window.ethereum) {
      const onArc = await isOnArcNetwork();
      if (!onArc) { showToast('Switch to Arc Testnet first', 'warning'); await switchToArc(); return; }
      // Real send via MetaMask
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const amountWei = ethers.parseUnits(amount, 6); // 6 decimals
        let txResponse;
        if (token === 'USDC') {
          // USDC is native on Arc \u2014 send as native transfer
          txResponse = await signer.sendTransaction({ to, value: amountWei * BigInt('1000000000000') });
        } else {
          // EURC is ERC-20
          const contract = new ethers.Contract(EURC_ADDRESS, ERC20_ABI, signer);
          txResponse = await contract.transfer(to, amountWei);
        }
        showToast('Transaction sent! Hash: ' + txResponse.hash.substring(0,12) + '\u2026', 'success');
        closeSendModal();
        setTimeout(() => refreshBalances(), 3000);
      } catch(err) {
        showToast('Transaction failed: ' + err.message, 'error');
      }
    } else {
      showToast('Connect MetaMask to send real transactions on Arc Network', 'warning');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('wallet-network-status'));
    const w = getStoredWallet();
    if (w) {
      // \u2500\u2500 Active session: show wallet dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('unlock-wallet-state').classList.add('hidden');
      document.getElementById('has-wallet-state').classList.remove('hidden');
      document.getElementById('wallet-addr-display').textContent = w.address;
      document.getElementById('receive-addr').textContent = w.address;
      const explorerLink = document.getElementById('explorer-link');
      if (explorerLink) { explorerLink.href = ARC.explorer + '/address/' + w.address; }

      // Check if on Arc
      if (w.type === 'metamask' && window.ethereum) {
        const onArc = await isOnArcNetwork();
        const dot = document.getElementById('network-dot');
        const label = document.getElementById('wallet-network-label');
        if (onArc) { dot.className='w-3 h-3 rounded-full bg-green-400 ml-auto'; label.textContent='Arc Testnet'; }
        else { dot.className='w-3 h-3 rounded-full bg-yellow-400 ml-auto animate-pulse'; label.textContent='Wrong Network'; }
      } else {
        document.getElementById('wallet-network-label').textContent = w.type==='internal' ? 'Arc Ready' : 'Connected';
      }

      // Fetch real balances
      await refreshBalances();
      // Load tx history
      await loadTxHistory(w.address);
    } else if (hasEncryptedWallet()) {
      // \u2500\u2500 Encrypted wallet exists but no active session: show unlock \u2500\u2500
      document.getElementById('no-wallet-state').classList.add('hidden');
      document.getElementById('unlock-wallet-state').classList.remove('hidden');
      setTimeout(() => { const el = document.getElementById('unlock-password'); if (el) el.focus(); }, 100);
    }
    // else: show no-wallet-state (already visible by default)
  });

  async function unlockWalletUI() {
    const pwd = document.getElementById('unlock-password').value;
    const errEl = document.getElementById('unlock-error');
    const btn = document.getElementById('unlock-btn');
    errEl.classList.add('hidden');
    if (!pwd) { errEl.classList.remove('hidden'); return; }
    btn.disabled = true;
    btn.innerHTML = '<span class=\\"loading-spinner inline-block mr-2\\"></span>Unlocking\u2026';
    const w = await unlockWallet(pwd);
    if (!w) {
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = '<i class=\\"fas fa-unlock\\"></i> Unlock Wallet';
      document.getElementById('unlock-password').value = '';
      document.getElementById('unlock-password').focus();
      return;
    }
    // Success: update badge and reload
    updateWalletBadge(w.address);
    showToast('Wallet unlocked!', 'success');
    setTimeout(() => location.reload(), 400);
  }

  function showForgotPasswordUI() {
    const panel = document.getElementById('forgot-password-panel');
    if (panel) panel.classList.toggle('hidden');
  }

  function confirmResetWallet() {
    if (!confirm('\u26A0\uFE0F This will delete your encrypted wallet data from this browser.\\nYou will need your seed phrase to restore access.\\n\\nContinue?')) return;
    clearWallet();
    showToast('Wallet data removed. Import again with seed phrase.', 'info');
    setTimeout(() => location.reload(), 1000);
  }
  </script>
  `);
}
function ordersPage() {
  return shell("My Orders", `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between gap-4 mb-2 flex-wrap">
      <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
        <i class="fas fa-box text-red-500"></i> My Orders
      </h1>
      <div id="orders-summary-badge" class="text-xs text-slate-400 font-mono bg-slate-100 px-3 py-1 rounded-full"></div>
    </div>
    <p class="text-slate-500 mb-2">Escrow-protected orders on Arc Network.</p>
    <div id="orders-network-status" class="mb-4"></div>

    <!-- Wallet indicator -->
    <div id="orders-wallet-bar" class="mb-4 hidden">
      <div class="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <i class="fas fa-wallet text-red-400"></i>
        <span>Showing orders for wallet: <span id="orders-wallet-addr" class="font-mono text-slate-700"></span></span>
      </div>
    </div>

    <!-- Tabs: Purchases / Sales -->
    <div class="flex gap-2 mb-6">
      <button id="tab-purchases" onclick="switchOrderTab('purchases')"
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white shadow-sm transition-all">
        <i class="fas fa-shopping-bag mr-1"></i> My Purchases
      </button>
      <button id="tab-sales" onclick="switchOrderTab('sales')"
        class="px-4 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
        <i class="fas fa-store mr-1"></i> My Sales
      </button>
    </div>
    <div id="orders-container">
      <div class="card p-8 text-center">
        <div class="loading-spinner-lg mx-auto mb-3"></div>
        <p class="text-slate-400 text-sm">Loading your orders\u2026</p>
      </div>
    </div>
  </div>

  <!-- Receipt / Shipping Modal root -->
  <div id="receipt-modal-root"></div>

  <!-- Orders page logic \u2014 no inline JS, loaded from static file -->
  <script src="/static/orders.js" defer></script>
  `);
}
function orderDetailPage(id) {
  return shell(`Order ${id}`, `
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="flex items-center gap-3 mb-6">
      <a href="/orders" class="text-slate-400 hover:text-red-600"><i class="fas fa-arrow-left"></i></a>
      <h1 class="text-2xl font-bold text-slate-800">Order <span class="font-mono">${id}</span></h1>
    </div>
    <div id="order-detail-container">
      <div class="card p-8 text-center">
        <div class="loading-spinner-lg mx-auto mb-4"></div>
        <p class="text-slate-400">Loading order from Arc Network\u2026</p>
      </div>
    </div>
  </div>
  <!-- Receipt Modal root -->
  <div id="receipt-modal-root"></div>

  <script>
  function _orderDetailInit(){
    var orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order=orders.find(function(o){ return o.id==='${id}'; });
    var container=document.getElementById('order-detail-container');
    if(!order){
      container.innerHTML='<div class="card p-8 text-center"><div class="empty-state"><i class="fas fa-box-open"></i><p class="font-medium text-slate-600">Order not found</p><a href="/orders" class="btn-primary mt-4 mx-auto">Back to Orders</a></div></div>';
      return;
    }
    var wallet = typeof getStoredWallet==='function' ? getStoredWallet() : null;
    var myAddr=wallet?wallet.address.toLowerCase():'';
    var isSeller=order.sellerAddress&&order.sellerAddress.toLowerCase()===myAddr;
    var isBuyer=order.buyerAddress&&order.buyerAddress.toLowerCase()===myAddr;
    var statusSteps=['escrow_pending','escrow_locked','shipped','delivery_confirmed','funds_released'];
    var statusIdx=Math.max(0,statusSteps.indexOf(order.status));
    var explorerTxUrl=order.explorerUrl||('${ARC.explorer}/tx/'+(order.txHash||''));

    // Build role-based action buttons
    let actionBtns='';
    var isDisputed=order.status==='dispute';
    var isPending=order.status==='escrow_pending';
    // \u2500\u2500 SELLER ACTIONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Only the seller sees seller-specific actions; buyer NEVER sees Release Funds
    if(isSeller){
      if(order.status==='escrow_pending')
        // Funds not locked yet \u2014 warn seller
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-clock"></i> Awaiting escrow lock by buyer</span>';

      if(order.status==='escrow_locked')
        // Funds locked \u2014 seller can now ship
        actionBtns+='<button data-oid="'+order.id+'" data-status="shipped" class="update-status-btn btn-primary"><i class="fas fa-shipping-fast mr-1"></i> Mark as Shipped</button>';

      if(order.status==='shipped')
        // Shipped \u2014 waiting for buyer to confirm delivery
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-semibold"><i class="fas fa-clock"></i> Waiting for buyer confirmation</span>';

      if(order.status==='delivery_confirmed'){
        // Buyer confirmed delivery \u2014 seller CAN now release funds
        if(order.orderId32)
          actionBtns+='<button data-oid="'+order.id+'" data-status="funds_released" class="update-status-btn btn-primary" style="background:linear-gradient(135deg,#16a34a,#15803d);"><i class="fas fa-coins mr-1"></i> Release Funds</button>';
        else
          actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold"><i class="fas fa-exclamation-triangle"></i> No on-chain escrow ID \u2014 cannot release</span>';
      }

      if(order.status==='funds_released')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Funds released to you</span>';

      if(isDisputed)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds Locked \u2014 Dispute Active</span>';
    }

    // \u2500\u2500 BUYER ACTIONS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // Buyer sees ONLY: Confirm Delivery (when shipped)
    // Buyer NEVER sees Release Funds \u2014 that is a seller-only action
    if(isBuyer){
      if(order.status==='escrow_locked')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-lock"></i> Funds locked in escrow \u2014 waiting for shipping</span>';

      if(order.status==='shipped')
        // Buyer confirms receipt of goods \u2192 calls confirmDelivery on-chain
        actionBtns+='<button data-oid="'+order.id+'" data-status="delivery_confirmed" class="update-status-btn btn-secondary"><i class="fas fa-check-circle mr-1"></i> Confirm Delivery</button>';

      if(order.status==='delivery_confirmed')
        // Delivery confirmed \u2014 waiting for seller to release funds
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Delivery confirmed \u2014 waiting for seller to release funds</span>';

      if(order.status==='funds_released')
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-semibold"><i class="fas fa-check-circle"></i> Order complete \u2014 funds released to seller</span>';

      if(isDisputed)
        actionBtns+='<span class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm font-semibold"><i class="fas fa-gavel"></i> Dispute Active \u2014 awaiting resolution</span>';
    }

    container.innerHTML=
      '<div class="space-y-6">'
      // Role badge
      +(isSeller ? '<div class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm font-medium text-amber-800"><i class="fas fa-store"></i> You are the seller of this order</div>' : '')
      +(isBuyer  ? '<div class="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm font-medium text-blue-800"><i class="fas fa-shopping-bag"></i> You are the buyer of this order</div>' : '')
      // \u2500\u2500 Escrow Pending warning banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      +(order.status==='escrow_pending'
        ? '<div class="card p-5 bg-amber-50 border-amber-300">'
          +'<div class="flex items-start gap-3">'
          +'<i class="fas fa-exclamation-triangle text-amber-500 text-xl mt-0.5 shrink-0"></i>'
          +'<div>'
          +'<h3 class="font-bold text-amber-800 mb-1">Escrow Pending</h3>'
          +'<p class="text-amber-700 text-sm">Funds have NOT been deposited into the escrow contract yet. '
          +'The ShuklyEscrow contract may not be deployed or the checkout did not complete all steps.</p>'
          +'<p class="text-amber-600 text-xs mt-2 font-medium">Go to <a href="/deploy-escrow" class="underline">Deploy Escrow</a> to set up the contract, then retry checkout.</p>'
          +'</div></div></div>'
        : '')
      // \u2500\u2500 Funds Released banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      +(order.status==='funds_released'
        ? '<div class="card p-6 text-center bg-emerald-50 border-emerald-200">'
          +'<div class="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">'
          +'<i class="fas fa-check-circle text-3xl text-emerald-500"></i></div>'
          +'<h3 class="text-xl font-bold text-emerald-800 mb-1">Funds Released!</h3>'
          +'<p class="text-emerald-700 text-sm mb-3">Escrow completed on-chain. Funds transferred to seller on Arc Network.</p>'
          +(order.releaseTxHash
            ? '<p class="text-xs text-emerald-600 font-mono mb-4"><a href="'+(order.releaseTxUrl||('${ARC.explorer}/tx/'+order.releaseTxHash))+'" target="_blank" class="underline">'+order.releaseTxHash+'</a></p>'
            : '')
          +'<button onclick="showReceiptModalDetail()" class="btn-primary mx-auto"><i class="fas fa-receipt mr-2"></i>View & Download Receipt</button>'
          +'</div>'
        : '')
      // Escrow Status
      +'<div class="card p-6">'
      +'<div class="flex items-center justify-between mb-4">'
      +'<h2 class="font-bold text-slate-800 flex items-center gap-2"><i class="fas fa-route text-red-500"></i> Escrow Status (Arc Network)</h2>'
      +'<span class="arc-badge"><i class="fas fa-network-wired text-xs"></i> Arc Testnet</span></div>'
      +'<div class="flex items-center gap-2 overflow-x-auto">'
      +['Pending','Locked','Shipped','Confirmed','Released'].map((s,i)=>
          '<div class="flex items-center gap-2 shrink-0">'
          +'<div class="flex flex-col items-center">'
          +'<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold '+(i<=statusIdx?'bg-green-500 text-white':'bg-slate-200 text-slate-400')+'">'
          +(i<statusIdx?'<i class="fas fa-check text-xs"></i>':(i+1))+'</div>'
          +'<p class="text-xs text-center mt-1 text-slate-400 w-14">'+s+'</p></div>'
          +(i<4?'<div class="w-8 h-0.5 '+(i<statusIdx?'bg-green-500':'bg-slate-200')+' mb-4"></div>':'')
          +'</div>'
        ).join('')
      +'</div></div>'
      // Transaction Details
      +'<div class="card p-6">'
      +'<h2 class="font-bold text-slate-800 mb-4 flex items-center gap-2"><i class="fas fa-receipt text-red-500"></i> On-Chain Details</h2>'
      +'<div class="space-y-3 text-sm">'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Order ID</span><span class="font-mono font-medium text-right">'+order.id+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Escrow Contract</span><a href="'+('${ARC.explorer}'+'/address/'+(order.escrowContract||''))+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+(order.escrowContract||'\u2014')+'</a></div>'
      +(order.orderId32 ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Order ID (bytes32)</span><span class="font-mono text-xs text-right break-all">'+order.orderId32+'</span></div>' : '')
      // createEscrow tx hash
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Create Tx</span>'
      +(order.txHash && !order.txHash.startsWith('PENDING_')
        ? '<a href="'+('${ARC.explorer}/tx/'+order.txHash)+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+order.txHash+'</a>'
        : '<span class="text-xs text-amber-600 font-medium flex items-center gap-1"><i class="fas fa-clock"></i> Not yet on-chain</span>')
      +'</div>'
      // fundEscrow tx hash
      +(order.fundTxHash
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Fund Tx</span>'
          +'<a href="'+'${ARC.explorer}/tx/'+order.fundTxHash+'" target="_blank" class="font-mono text-xs text-indigo-600 hover:underline text-right break-all">'+order.fundTxHash+'</a></div>'
        : '')
      // confirmDelivery tx hash
      +(order.confirmDeliveryTx
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Confirm Delivery Tx</span>'
          +'<a href="'+(order.confirmDeliveryUrl||'${ARC.explorer}/tx/'+order.confirmDeliveryTx)+'" target="_blank" class="font-mono text-xs text-blue-600 hover:underline text-right break-all">'+order.confirmDeliveryTx+'</a></div>'
        : '')
      // Release tx hash (takerDeliver) \u2014 only shown after release
      +(order.releaseTxHash
        ? '<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Release Tx</span>'
          +'<a href="'+(order.releaseTxUrl||('${ARC.explorer}/tx/'+order.releaseTxHash))+'" target="_blank" class="font-mono text-xs text-emerald-600 hover:underline text-right break-all">'+order.releaseTxHash+'</a></div>'
        : '')
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Buyer</span><span class="font-mono text-xs text-right break-all">'+(order.buyerAddress||'\u2014')+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Seller</span><span class="font-mono text-xs text-right break-all">'+(order.sellerAddress||'\u2014')+'</span></div>'
      +'<div class="flex justify-between items-start gap-4"><span class="text-slate-500 shrink-0">Amount</span><span class="font-bold text-red-600">'+(order.amount||0)+' '+(order.token||'USDC')+'</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Network</span><span class="font-medium">Arc Testnet (Chain 5042002)</span></div>'
      +'<div class="flex justify-between"><span class="text-slate-500">Created</span><span>'+new Date(order.createdAt).toLocaleString()+'</span></div>'
      +'</div></div>'
      // Shipping Info \u2014 shown to buyer when available
      +(isBuyer && order.shippingInfo
        ? '<div class="card p-6" style="background:#f0f9ff;border:1px solid #bae6fd;">'
          +'<h2 class="font-bold text-blue-800 mb-4 flex items-center gap-2"><i class="fas fa-shipping-fast text-blue-500"></i> Shipping Information</h2>'
          +'<div class="space-y-3 text-sm">'
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Carrier</span><span class="font-semibold text-slate-800">'+order.shippingInfo.carrier+'</span></div>'
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Tracking #</span><span class="font-mono text-sm text-slate-800">'+order.shippingInfo.trackingNumber+'</span></div>'
          +(order.shippingInfo.trackingLink
            ? '<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Track Link</span><a href="'+order.shippingInfo.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs break-all">'+order.shippingInfo.trackingLink+'</a></div>'
            : '')
          +(order.shippingInfo.notes
            ? '<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Notes</span><span class="text-slate-600 italic text-xs text-right">'+order.shippingInfo.notes+'</span></div>'
            : '')
          +'<div class="flex justify-between items-start gap-4"><span class="text-blue-700 shrink-0 font-medium">Sent at</span><span class="text-xs text-slate-500">'+new Date(order.shippingInfo.sentAt).toLocaleString()+'</span></div>'
          +'</div></div>'
        : '')
      // Shipping Info \u2014 shown to seller (read-only view of what was sent)
      +(isSeller && order.shippingInfo
        ? '<div class="card p-6" style="background:#fffbeb;border:1px solid #fde68a;">'
          +'<h2 class="font-bold text-amber-800 mb-4 flex items-center gap-2"><i class="fas fa-shipping-fast text-amber-500"></i> Shipping Info Sent to Buyer</h2>'
          +'<div class="space-y-2 text-sm">'
          +'<p class="text-slate-700"><strong>Carrier:</strong> '+order.shippingInfo.carrier+'</p>'
          +'<p class="text-slate-700"><strong>Tracking #:</strong> <span class="font-mono">'+order.shippingInfo.trackingNumber+'</span></p>'
          +(order.shippingInfo.trackingLink ? '<p class="text-slate-700"><strong>Link:</strong> <a href="'+order.shippingInfo.trackingLink+'" target="_blank" class="text-blue-600 hover:underline text-xs">'+order.shippingInfo.trackingLink+'</a></p>' : '')
          +(order.shippingInfo.notes ? '<p class="text-slate-600 italic text-xs">'+order.shippingInfo.notes+'</p>' : '')
          +'</div></div>'
        : '')
      // Actions
      +'<div class="flex flex-wrap gap-3">'
      +actionBtns
      // Only show Open Dispute button if not already disputed AND user is buyer or seller
      +((!isDisputed && (isBuyer||isSeller))
        ?'<button data-oid="'+order.id+'" class="open-dispute-btn btn-secondary"><i class="fas fa-gavel mr-1"></i> Open Dispute</button>'
        :(isDisputed?'<a href="/disputes" class="btn-secondary text-sm"><i class="fas fa-gavel mr-1"></i> View Dispute</a>':''))
      +'<button onclick="showReceiptModalDetail()" class="btn-secondary text-sm"><i class="fas fa-receipt mr-1"></i> View Receipt</button>'
      +'<a href="'+explorerTxUrl+'" target="_blank" class="btn-secondary text-sm"><i class="fas fa-external-link-alt mr-1"></i> Arc Explorer</a>'
      +'</div>'
      +'</div>';
    // Attach event listeners for action buttons
    document.querySelectorAll('.update-status-btn').forEach(function(b){
      b.addEventListener('click',function(){ updateOrderStatus(this.dataset.oid, this.dataset.status); });
    });
    document.querySelectorAll('.open-dispute-btn').forEach(function(b){
      b.addEventListener('click',function(){ openDisputeForm(this.dataset.oid); });
    });
  } /* end _orderDetailInit */

  async function updateOrderStatus(id,s){
    // If marking as shipped, show shipping info form first
    if(s==='shipped'){
      showShippingFormDetail(id);
      return;
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    //  CONFIRM DELIVERY \u2014 BUYER calls confirmDelivery(orderId32)
    //  Security: Only the buyer can confirm delivery.
    //  This signals goods received; seller can now call releaseFunds.
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    if(s==='delivery_confirmed'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];

      const btn=event && event.target;
      const origLabel='<i class="fas fa-check-circle mr-1"></i> Confirm Delivery';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising\u2026'; }

      // \u2500\u2500 ROLE CHECK: only the buyer can confirm delivery \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const _w0 = getStoredWallet();
      if(!_w0){
        showToast('Connect wallet to confirm delivery','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }
      const _isBuyer0 = order.buyerAddress && order.buyerAddress.toLowerCase() === _w0.address.toLowerCase();
      if(!_isBuyer0){
        showToast('Only the buyer can confirm delivery','error');
        console.error('[confirmDelivery] Role check failed \u2014 caller is not the buyer');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      if(!order.orderId32){
        showToast('No on-chain order ID found. Cannot confirm delivery.','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      try {
        const w=_w0;  // reuse already-loaded wallet

        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){
            showToast('Please switch MetaMask to Arc Testnet','warning');
            if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
          }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else {
          showToast('Private key unavailable. Re-import wallet.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){
          showToast('Escrow contract not configured','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Confirming delivery\u2026';
        showToast('Sending confirmDelivery on-chain\u2026','info');

        const tx = await escrowContract.confirmDelivery(order.orderId32, { gasLimit: 150000 });
        showToast('Tx sent: '+tx.hash.slice(0,14)+'\u2026 Waiting\u2026','info');
        const receipt = await tx.wait(1);
        if(!receipt || receipt.status===0) throw new Error('confirmDelivery reverted');

        showToast('Delivery confirmed on-chain! Tx: '+tx.hash.slice(0,14)+'\u2026','success');
        orders[idx].status             = 'delivery_confirmed';
        orders[idx].confirmDeliveryTx  = tx.hash;
        orders[idx].confirmDeliveryUrl = window.ARC.explorer+'/tx/'+tx.hash;
        orders[idx].updatedAt          = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);
      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001
          ? 'Confirm delivery rejected by user'
          : 'confirmDelivery error: '+(err.shortMessage||err.message||'');
        showToast(msg,'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    //  RELEASE FUNDS \u2014 SELLER calls releaseFunds(orderId32) on ShuklyEscrow
    //  Security: Only the seller can call this function.
    //  Direct on-chain call \u2014 no Permit2, no relayer, no signature
    //
    //  Flow:
    //   1. Seller calls releaseFunds(orderId32) on ShuklyEscrow
    //   2. Contract releases locked tokens to seller
    //   3. UI updates ONLY after tx is confirmed (receipt.status === 1)
    //
    //  "to" address = ShuklyEscrow contract \u2014 never directly to seller
    // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
    if(s==='funds_released'){
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      const idx=orders.findIndex(o=>o.id===id);
      if(idx<0) return;
      const order=orders[idx];

      const btn=event && event.target;
      const origLabel='<i class="fas fa-coins mr-1"></i> Release Funds';
      if(btn){ btn.disabled=true; btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Initialising\u2026'; }

      // \u2500\u2500 ROLE CHECK: only the seller can release funds \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      const _w = getStoredWallet();
      if(!_w){
        showToast('Connect wallet to release funds','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }
      const _isSeller = order.sellerAddress && order.sellerAddress.toLowerCase() === _w.address.toLowerCase();
      if(!_isSeller){
        showToast('Only the seller can release funds from escrow','error');
        console.error('[releaseFunds] Role check failed \u2014 caller is not the seller');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      // \u2500\u2500 STATUS CHECK: must be delivery_confirmed \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
      if(order.status !== 'delivery_confirmed'){
        showToast('Cannot release funds \u2014 buyer has not confirmed delivery yet','error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      if(!order.orderId32){
        showToast(
          'This order was not locked on-chain (no orderId32). ' +
          'Funds were never deposited into the escrow contract \u2014 nothing to release.',
          'error'
        );
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
        return;
      }

      try {
        // \u2500\u2500 Connect wallet \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        const w=getStoredWallet();
        if(!w){ showToast('Connect wallet to release funds','error'); if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return; }

        let provider, signer;
        if(w.type==='metamask' && window.ethereum){
          provider = new ethers.BrowserProvider(window.ethereum);
          const net = await provider.getNetwork();
          if(net.chainId !== BigInt(window.ARC.chainId)){
            showToast('Please switch MetaMask to Arc Testnet (Chain 5042002)','warning');
            if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
          }
          signer = await provider.getSigner();
        } else if((w.type==='internal'||w.type==='imported') && w.privateKey && !w.privateKey.startsWith('[')){
          provider = new ethers.JsonRpcProvider(window.ARC.rpc);
          signer   = new ethers.Wallet(w.privateKey, provider);
        } else {
          showToast('Private key unavailable. Re-import wallet to release funds.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        // \u2500\u2500 Get escrow contract \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        const escrowAddress = getEscrowAddress();
        if(!escrowAddress || escrowAddress==='0x0000000000000000000000000000000000000000'){
          showToast('Escrow contract not configured. Visit /deploy-escrow.','error');
          if(btn){btn.disabled=false;btn.innerHTML=origLabel;} return;
        }

        const escrowContract = new ethers.Contract(escrowAddress, ESCROW_ABI, signer);

        // \u2500\u2500 Call releaseFunds(orderId32) \u2014 no permit, no signature \u2500\u2500
        if(btn) btn.innerHTML='<span class="loading-spinner inline-block mr-2"></span>Sending to escrow\u2026';
        showToast('Broadcasting releaseFunds to ShuklyEscrow\u2026','info');

        const txResponse = await escrowContract.releaseFunds(order.orderId32, { gasLimit: 200000 });
        showToast('Tx sent! Waiting for confirmation\u2026 '+txResponse.hash.slice(0,14)+'\u2026','info');

        // Wait for on-chain confirmation before updating UI
        const receipt = await txResponse.wait(1);
        if(!receipt || receipt.status === 0){
          throw new Error('releaseFunds reverted on-chain. Check escrow state (must be CONFIRMED).');
        }

        const releaseTxHash = txResponse.hash;
        showToast('Funds released! Tx: '+releaseTxHash.slice(0,14)+'\u2026','success');

        // \u2500\u2500 Update order status ONLY after confirmed receipt \u2500\u2500\u2500\u2500\u2500\u2500\u2500
        orders[idx].status         = 'funds_released';
        orders[idx].releaseTxHash  = releaseTxHash;
        orders[idx].releaseTxUrl   = window.ARC.explorer+'/tx/'+releaseTxHash;
        orders[idx].updatedAt      = new Date().toISOString();
        localStorage.setItem('rh_orders', JSON.stringify(orders));
        setTimeout(()=>location.reload(), 800);

      } catch(err){
        const msg = err.code==='ACTION_REJECTED'||err.code===4001
          ? 'Release rejected by user'
          : 'Release error: '+(err.shortMessage||err.message||'');
        showToast(msg, 'error');
        if(btn){ btn.disabled=false; btn.innerHTML=origLabel; }
      }
      return;
    }

    // \u2500\u2500 Default: update status locally (shipped, completed, etc.) \u2500\u2500
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const i=orders.findIndex(o=>o.id===id);
    if(i>=0){
      orders[i].status=s;
      orders[i].updatedAt=new Date().toISOString();
      localStorage.setItem('rh_orders',JSON.stringify(orders));
      const labels={'shipped':'Order marked as shipped!','completed':'Delivery confirmed!'};
      showToast(labels[s]||'Status updated','success');
      setTimeout(()=>location.reload(),800);
    }
  }

  function showShippingFormDetail(orderId){
    var root=document.getElementById('receipt-modal-root');
    if(!root) return;
    root.innerHTML=
      '<div id="ship-overlay-d" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'+
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:480px;max-height:90vh;overflow-y:auto;">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:36px;height:36px;border-radius:8px;background:#fef2f2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-shipping-fast" style="color:#ef4444;"></i></div>'+
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Shipping Information</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order '+orderId+'</p></div></div>'+
      '<button id="ship-close-d" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'+
      '</div>'+
      '<div style="padding:20px;display:flex;flex-direction:column;gap:14px;">'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Number *</label>'+
      '<input id="ship-tracking-d" type="text" placeholder="e.g. 1Z999AA10123456784" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Shipping Carrier *</label>'+
      '<input id="ship-carrier-d" type="text" placeholder="e.g. UPS, FedEx, DHL, USPS" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Tracking Link (optional)</label>'+
      '<input id="ship-link-d" type="url" placeholder="https://tracking.example.com/ABC123" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box;"/></div>'+
      '<div><label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">Additional Notes (optional)</label>'+
      '<textarea id="ship-notes-d" rows="3" placeholder="Any notes for the buyer\u2026" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:none;box-sizing:border-box;"></textarea></div>'+
      '</div>'+
      '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'+
      '<button id="ship-cancel-d" style="padding:8px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;cursor:pointer;">Cancel</button>'+
      '<button id="ship-confirm-d" style="padding:8px 20px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:600;cursor:pointer;"><i class="fas fa-paper-plane" style="margin-right:6px;"></i>Send Shipping Info to Buyer</button>'+
      '</div></div></div>';
    function closeD(){ root.innerHTML=''; }
    document.getElementById('ship-close-d').onclick=closeD;
    document.getElementById('ship-cancel-d').onclick=closeD;
    document.getElementById('ship-overlay-d').addEventListener('click',function(e){ if(e.target===this) closeD(); });
    document.getElementById('ship-confirm-d').onclick=function(){
      var tracking=document.getElementById('ship-tracking-d').value.trim();
      var carrier=document.getElementById('ship-carrier-d').value.trim();
      var link=document.getElementById('ship-link-d').value.trim();
      var notes=document.getElementById('ship-notes-d').value.trim();
      if(!tracking){showToast('Please enter a tracking number','error');return;}
      if(!carrier){showToast('Please enter the shipping carrier','error');return;}
      var orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
      var i=orders.findIndex(function(o){return o.id===orderId;});
      if(i>=0){
        orders[i].status='shipped';
        orders[i].shippedAt=new Date().toISOString();
        orders[i].updatedAt=new Date().toISOString();
        orders[i].shippingInfo={trackingNumber:tracking,carrier:carrier,trackingLink:link||null,notes:notes||null,sentAt:new Date().toISOString()};
        localStorage.setItem('rh_orders',JSON.stringify(orders));
        closeD();
        showToast('Shipping info sent to buyer! Order marked as shipped.','success');
        setTimeout(function(){location.reload();},800);
      }
    };
  }
  function openDisputeForm(id){
    var ordersRaw=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var order=ordersRaw.find(function(o){return o.id===id;});
    if(!order){showToast('Order not found','error');return;}
    // Access control: only buyer or seller
    var wallet=typeof getStoredWallet==='function'?getStoredWallet():null;
    var myAddr=wallet?wallet.address.toLowerCase():'';
    var isBuyerOrSeller=(order.buyerAddress&&order.buyerAddress.toLowerCase()===myAddr)||(order.sellerAddress&&order.sellerAddress.toLowerCase()===myAddr);
    if(!isBuyerOrSeller){showToast('Only the buyer or seller can open a dispute','error');return;}

    var root=document.getElementById('receipt-modal-root');
    if(!root)return;
    root.innerHTML=
      '<div id="dispute-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;">'+
      '<div style="background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.3);width:100%;max-width:560px;max-height:92vh;overflow-y:auto;">'+

      // \u2500\u2500 Header
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 20px 14px;border-bottom:1px solid #f1f5f9;">'+
      '<div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:38px;height:38px;border-radius:10px;background:#fee2e2;display:flex;align-items:center;justify-content:center;"><i class="fas fa-gavel" style="color:#dc2626;font-size:16px;"></i></div>'+
      '<div><p style="font-weight:700;color:#1e293b;margin:0;font-size:15px;">Open Dispute</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:0;">Order '+id+' &bull; Funds will remain locked</p></div></div>'+
      '<button id="disp-close" style="width:32px;height:32px;border:none;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:18px;color:#64748b;">&times;</button>'+
      '</div>'+

      // \u2500\u2500 Fund-lock notice
      '<div style="margin:16px 20px 0;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;display:flex;gap:10px;align-items:flex-start;">'+
      '<i class="fas fa-lock" style="color:#dc2626;margin-top:2px;flex-shrink:0;"></i>'+
      '<div style="font-size:13px;color:#7f1d1d;"><strong>Funds will remain locked.</strong> While a dispute is open, USDC/EURC stays in the Arc Network escrow contract. No release or transfer is possible until the dispute is resolved.</div>'+
      '</div>'+

      // \u2500\u2500 Form body
      '<div style="padding:20px;display:flex;flex-direction:column;gap:16px;">'+

      // Description textarea
      '<div>'+
      '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Description <span style="color:#dc2626;">*</span></label>'+
      '<textarea id="disp-desc" rows="4" placeholder="Describe your issue in detail. Include dates, what was expected, and what actually happened..." style="width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;outline:none;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>'+
      '</div>'+

      // File upload
      '<div>'+
      '<label style="display:block;font-size:12px;font-weight:700;color:#475569;margin-bottom:5px;text-transform:uppercase;letter-spacing:.04em;">Evidence Files <span style="font-weight:400;text-transform:none;letter-spacing:0;">(images &amp; PDFs, optional)</span></label>'+
      '<div id="disp-dropzone" style="border:2px dashed #e2e8f0;border-radius:10px;padding:24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;">'+
      '<i class="fas fa-cloud-upload-alt" style="font-size:28px;color:#94a3b8;display:block;margin-bottom:8px;"></i>'+
      '<p style="font-size:13px;color:#64748b;margin:0;">Click to choose files or drag &amp; drop here</p>'+
      '<p style="font-size:11px;color:#94a3b8;margin:4px 0 0;">Accepted: PNG, JPG, PDF &bull; Up to 5 files &bull; 10 MB each</p>'+
      '</div>'+
      '<input id="disp-file-input" type="file" multiple accept="image/png,image/jpeg,application/pdf" style="display:none;">'+
      '<ul id="disp-file-list" style="margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;"></ul>'+
      '</div>'+

      '</div>'+

      // \u2500\u2500 Footer buttons
      '<div style="padding:14px 20px;border-top:1px solid #f1f5f9;display:flex;gap:8px;justify-content:flex-end;">'+
      '<button id="disp-cancel" style="padding:9px 18px;border:1.5px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;font-size:13px;font-weight:600;cursor:pointer;">Cancel</button>'+
      '<button id="disp-submit" style="padding:9px 22px;border:none;border-radius:8px;background:#dc2626;color:#fff;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:7px;"><i class="fas fa-gavel"></i> Submit Dispute</button>'+
      '</div>'+

      '</div></div>';

    // \u2500\u2500 Selected files state
    var selectedFiles=[];

    // \u2500\u2500 Dropzone styling
    var dz=document.getElementById('disp-dropzone');
    dz.addEventListener('click',function(){ document.getElementById('disp-file-input').click(); });
    dz.addEventListener('dragover',function(e){e.preventDefault();this.style.borderColor='#dc2626';this.style.background='#fff5f5';});
    dz.addEventListener('dragleave',function(){this.style.borderColor='#e2e8f0';this.style.background='';});
    dz.addEventListener('drop',function(e){
      e.preventDefault();this.style.borderColor='#e2e8f0';this.style.background='';
      addFiles(Array.from(e.dataTransfer.files));
    });

    // \u2500\u2500 File input change
    document.getElementById('disp-file-input').addEventListener('change',function(){
      addFiles(Array.from(this.files));
      this.value=''; // reset so same file can be re-added after remove
    });

    function addFiles(files){
      var allowed=['image/png','image/jpeg','application/pdf'];
      files.forEach(function(f){
        if(!allowed.includes(f.type)){showToast('Only PNG, JPG, and PDF files are accepted','error');return;}
        if(f.size>10*1024*1024){showToast(f.name+' exceeds the 10 MB limit','error');return;}
        if(selectedFiles.length>=5){showToast('Maximum 5 files per dispute','error');return;}
        // Prevent duplicates by name+size
        var dup=selectedFiles.some(function(x){return x.name===f.name&&x.size===f.size;});
        if(dup){showToast(f.name+' is already added','info');return;}
        selectedFiles.push(f);
      });
      renderFileList();
    }

    function renderFileList(){
      var ul=document.getElementById('disp-file-list');
      if(!ul)return;
      ul.innerHTML=selectedFiles.map(function(f,i){
        var icon=f.type==='application/pdf'?'fa-file-pdf':'fa-file-image';
        var size=(f.size/1024)<1024?(Math.round(f.size/1024)+'KB'):(Math.round(f.size/1024/10.24)/100+' MB');
        return '<li style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:7px;">'+
          '<i class="fas '+icon+'" style="color:#64748b;font-size:14px;flex-shrink:0;"></i>'+
          '<span style="flex:1;font-size:12px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escapeHtml(f.name)+'</span>'+
          '<span style="font-size:11px;color:#94a3b8;flex-shrink:0;">'+size+'</span>'+
          '<button data-idx="'+i+'" class="disp-remove-file" style="width:22px;height:22px;border:none;background:transparent;cursor:pointer;color:#94a3b8;font-size:14px;flex-shrink:0;padding:0;" title="Remove">&times;</button>'+
          '</li>';
      }).join('');
      ul.querySelectorAll('.disp-remove-file').forEach(function(btn){
        btn.addEventListener('click',function(){
          selectedFiles.splice(parseInt(this.dataset.idx),1);
          renderFileList();
        });
      });
    }

    // \u2500\u2500 escapeHtml helper (local scope)
    function escapeHtml(s){
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // \u2500\u2500 Read files as Data URLs for local storage
    function readFileAsDataURL(file){
      return new Promise(function(resolve){
        var r=new FileReader();
        r.onload=function(e){resolve({name:file.name,type:file.type,size:file.size,dataUrl:e.target.result});};
        r.readAsDataURL(file);
      });
    }

    // \u2500\u2500 Close handlers
    function closeDisputeModal(){root.innerHTML='';}
    document.getElementById('disp-close').onclick=closeDisputeModal;
    document.getElementById('disp-cancel').onclick=closeDisputeModal;
    document.getElementById('dispute-overlay').addEventListener('click',function(e){if(e.target===this)closeDisputeModal();});

    // \u2500\u2500 Submit
    document.getElementById('disp-submit').onclick=async function(){
      var desc=document.getElementById('disp-desc').value.trim();
      if(!desc){showToast('Please describe your issue before submitting','error');document.getElementById('disp-desc').focus();return;}

      var btn=this;
      btn.disabled=true;
      btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving\u2026';

      try{
        // Read all files as Data URLs (stored locally \u2014 IPFS integration point)
        var fileRecords=await Promise.all(selectedFiles.map(readFileAsDataURL));

        // Save evidence object
        var evidence={
          orderId:id,
          submittedBy:myAddr,
          submittedAt:new Date().toISOString(),
          description:desc,
          files:fileRecords.map(function(f){return{name:f.name,type:f.type,size:f.size,dataUrl:f.dataUrl};})
          // NOTE: In a production deployment, replace dataUrl with an IPFS hash/URL
          // by uploading via: https://api.pinata.cloud/pinning/pinFileToIPFS or web3.storage
        };

        // Persist evidence to localStorage (key: rh_dispute_evidence)
        var allEvidence=JSON.parse(localStorage.getItem('rh_dispute_evidence')||'{}');
        if(!allEvidence[id])allEvidence[id]=[];
        allEvidence[id].push(evidence);
        localStorage.setItem('rh_dispute_evidence',JSON.stringify(allEvidence));

        // Update order status to 'dispute' and lock funds
        var orders2=JSON.parse(localStorage.getItem('rh_orders')||'[]');
        var idx=orders2.findIndex(function(o){return o.id===id;});
        if(idx>=0){
          orders2[idx].status='dispute';
          orders2[idx].disputedAt=new Date().toISOString();
          orders2[idx].disputeLockedFunds=true;   // explicit fund-lock flag
          orders2[idx].disputeEvidenceCount=(orders2[idx].disputeEvidenceCount||0)+1;
          localStorage.setItem('rh_orders',JSON.stringify(orders2));
        }

        closeDisputeModal();
        showToast('Dispute opened \u2014 funds remain locked in Arc escrow. Evidence saved.','success');
        setTimeout(function(){location.reload();},900);

      }catch(e){
        console.error('[dispute]',e);
        showToast('Error saving dispute. Please try again.','error');
        btn.disabled=false;
        btn.innerHTML='<i class="fas fa-gavel"></i> Submit Dispute';
      }
    };
  }

  function showReceiptModalDetail(){
    // Delegate to the shared showReceiptModal function
    showReceiptModal('${id}');
  }
  /* Bootstrap \u2014 same IIFE pattern as orders.js (no setTimeout) */
  (function(){
    function _run(){
      if(!document.getElementById('order-detail-container')){
        document.addEventListener('DOMContentLoaded', _orderDetailInit);
        return;
      }
      _orderDetailInit();
    }
    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded', _run);
    } else {
      _run();
    }
  })();
  </script>
  `);
}
function sellPage() {
  return shell("Sell on Shukly Store", `
  <style>
    /* \u2500\u2500 Multi-image upload system \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */
    .mi-drop-zone {
      border: 2px dashed #cbd5e1;
      border-radius: 16px;
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      transition: border-color .2s, background .2s;
      position: relative;
    }
    .mi-drop-zone.drag-over {
      border-color: #dc2626;
      background: rgba(220,38,38,.04);
    }
    .mi-drop-zone.has-images {
      padding: 16px 20px;
      border-color: #e2e8f0;
    }
    .mi-drop-zone:hover { border-color: #dc2626; background: rgba(220,38,38,.02); }

    /* Grid of previews */
    .mi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }
    @media (max-width: 480px) {
      .mi-grid { grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; }
    }

    .mi-thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      border: 2px solid #e2e8f0;
      background: #f8fafc;
      cursor: grab;
      transition: transform .2s, box-shadow .2s, border-color .2s;
      animation: miThumbIn .25s cubic-bezier(.34,1.56,.64,1) both;
    }
    @keyframes miThumbIn {
      from { opacity:0; transform:scale(.7); }
      to   { opacity:1; transform:scale(1); }
    }
    .mi-thumb.is-cover {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220,38,38,.18);
    }
    .mi-thumb:active { cursor: grabbing; }
    .mi-thumb.dragging { opacity: .4; transform: scale(.95); }
    .mi-thumb.drag-target { border-color: #dc2626; box-shadow: 0 0 0 2px #dc2626; }

    .mi-thumb img {
      width: 100%; height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    /* Cover badge */
    .mi-cover-badge {
      position: absolute; bottom: 0; left: 0; right: 0;
      background: linear-gradient(0deg, rgba(220,38,38,.85) 0%, transparent 100%);
      color: #fff;
      font-size: 9px; font-weight: 700; letter-spacing: .4px;
      padding: 10px 4px 4px;
      text-align: center;
      text-transform: uppercase;
    }

    /* Remove button */
    .mi-remove {
      position: absolute; top: 4px; right: 4px;
      width: 22px; height: 22px;
      background: rgba(15,23,42,.7);
      border: none; border-radius: 50%;
      color: #fff; font-size: 10px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      opacity: 0;
      transition: opacity .15s, background .15s;
    }
    .mi-thumb:hover .mi-remove { opacity: 1; }
    .mi-remove:hover { background: #dc2626; }

    /* Drag handle */
    .mi-drag-handle {
      position: absolute; top: 4px; left: 4px;
      width: 20px; height: 20px;
      background: rgba(15,23,42,.55);
      border-radius: 5px;
      color: rgba(255,255,255,.8); font-size: 9px;
      display: flex; align-items: center; justify-content: center;
      opacity: 0;
      transition: opacity .15s;
      cursor: grab;
    }
    .mi-thumb:hover .mi-drag-handle { opacity: 1; }

    /* Add-more slot */
    .mi-add-slot {
      aspect-ratio: 1;
      border-radius: 12px;
      border: 2px dashed #cbd5e1;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      cursor: pointer;
      transition: border-color .2s, background .2s;
      color: #94a3b8;
      font-size: 11px; font-weight: 600;
      gap: 4px;
      background: #f8fafc;
    }
    .mi-add-slot:hover { border-color: #dc2626; color: #dc2626; background: #fef2f2; }
    .mi-add-slot i { font-size: 20px; }

    /* Counter + hint bar */
    .mi-bar {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 12px; color: #64748b;
      margin-bottom: 8px;
    }
    .mi-bar .mi-count { font-weight: 700; color: #1e293b; }
    .mi-bar .mi-hint  { color: #94a3b8; font-size: 11px; }

    /* Error message */
    .mi-error {
      background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 8px; padding: 8px 12px;
      font-size: 12px; color: #dc2626;
      display: flex; align-items: center; gap-6px;
      margin-top: 8px; animation: miThumbIn .2s ease both;
    }

    /* Processing overlay */
    .mi-processing {
      position: absolute; inset: 0;
      background: rgba(248,250,252,.85);
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
    }

    /* URL tab */
    #img-panel-url input { transition: border-color .2s; }
  </style>

  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="text-center mb-8">
      <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-2xl mx-auto mb-4 shadow-xl">
        <i class="fas fa-store"></i>
      </div>
      <h1 class="text-3xl font-extrabold text-slate-800 mb-2">Start Selling</h1>
      <p class="text-slate-500">List your product on Arc Network \u2014 receive USDC or EURC through escrow.</p>
    </div>

    <!-- Wallet check -->
    <div id="sell-wallet-check" class="mb-6"></div>
    <div id="sell-network-status" class="mb-6"></div>

    <div class="card p-8">
      <h2 class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
        <i class="fas fa-plus-circle text-red-500"></i> New Product Listing
      </h2>
      <div class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Product Name *</label>
            <input type="text" id="prod-name" placeholder="e.g. Vintage Sneakers, Handmade Bracelet\u2026" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Category *</label>
            <select id="prod-cat" class="select">
              <option value="">Select category</option>
              <option>Electronics</option><option>Gaming</option><option>Audio</option>
              <option>Photography</option><option>Wearables</option><option>Accessories</option>
              <option>Pet Shop</option><option>Baby &amp; Kids</option>
              <option>Beauty &amp; Personal Care</option><option>Fashion &amp; Accessories</option>
              <option>Other</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-slate-700 mb-1">Description *</label>
          <textarea id="prod-desc" rows="4" placeholder="Describe your product in detail\u2026" class="input resize-none"></textarea>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Price *</label>
            <input type="number" id="prod-price" placeholder="0.00" step="0.000001" class="input"/>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Token *</label>
            <select id="prod-token" class="select">
              <option value="USDC">USDC (Arc native)</option>
              <option value="EURC">EURC (ERC-20)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-slate-700 mb-1">Stock *</label>
            <input type="number" id="prod-stock" placeholder="1" min="1" class="input"/>
          </div>
        </div>

        <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
             MULTI-IMAGE UPLOAD (max 5)
             \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-semibold text-slate-700">
              Product Images <span class="font-normal text-slate-400">(1\u20135 images)</span>
            </label>
            <!-- Source tab switcher -->
            <div class="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button type="button" id="tab-upload" onclick="miSwitchTab('upload')"
                class="px-3 py-1 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm">
                <i class="fas fa-camera mr-1"></i>Upload
              </button>
              <button type="button" id="tab-url" onclick="miSwitchTab('url')"
                class="px-3 py-1 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700">
                <i class="fas fa-link mr-1"></i>URL
              </button>
            </div>
          </div>

          <!-- \u2500\u2500 UPLOAD tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
          <div id="img-panel-upload">

            <!-- Drop zone (doubles as grid container when images exist) -->
            <div id="mi-drop-zone" class="mi-drop-zone"
              ondragover="miDragOver(event)"
              ondragleave="miDragLeave(event)"
              ondrop="miDrop(event)"
              onclick="miZoneClick(event)">

              <!-- counter bar (visible when images > 0) -->
              <div id="mi-bar" class="mi-bar hidden">
                <span><span id="mi-count" class="mi-count">0</span>/5 images
                  <span class="text-xs text-red-600 font-semibold ml-2" id="mi-cover-hint">First image = cover</span>
                </span>
                <span class="mi-hint"><i class="fas fa-grip-vertical mr-1"></i>Drag to reorder</span>
              </div>

              <!-- thumbnails grid -->
              <div id="mi-grid" class="mi-grid hidden"></div>

              <!-- empty state (shown when no images) -->
              <div id="mi-empty-state">
                <i class="fas fa-images text-4xl text-slate-200 mb-3 block"></i>
                <p class="text-sm font-semibold text-slate-500 mb-1">
                  Drag &amp; drop images here or <span class="text-red-600">click to choose</span>
                </p>
                <p class="text-xs text-slate-400">JPG, PNG, WEBP \xB7 Max 5 MB per image \xB7 Up to 5 images \xB7 Auto-compressed</p>
              </div>

              <!-- global processing overlay (shown while any image is compressing) -->
              <div id="mi-processing-overlay" class="hidden" style="pointer-events:none;position:absolute;inset:0;background:rgba(255,255,255,.7);border-radius:14px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:#64748b;">
                <span class="loading-spinner inline-block"></span>
                <span id="mi-processing-text">Processing\u2026</span>
              </div>
            </div>

            <!-- Hidden file input (multiple) -->
            <input type="file" id="mi-file-input" accept="image/jpeg,image/png,image/webp"
              multiple class="hidden" onchange="miHandleFiles(this.files)"/>

            <!-- Error message container -->
            <div id="mi-error" class="hidden mi-error">
              <i class="fas fa-exclamation-circle mr-1.5"></i>
              <span id="mi-error-text"></span>
            </div>

            <!-- Info strip -->
            <div class="flex items-center gap-2 mt-2 text-xs text-slate-400">
              <i class="fas fa-info-circle text-blue-400"></i>
              <span>First image is the cover. Drag thumbnails to reorder. Max 5 images, 5 MB each.</span>
            </div>
          </div>

          <!-- \u2500\u2500 URL / IPFS tab \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
          <div id="img-panel-url" class="hidden">
            <input type="url" id="prod-img" placeholder="https://... or ipfs://..." class="input mb-2"/>
            <div id="img-url-preview-wrap" class="hidden mt-2 flex items-center gap-3">
              <img id="img-url-preview" src="" alt="Preview"
                class="w-20 h-20 rounded-xl object-cover border border-slate-200 shadow-sm"
                onerror="this.parentElement.classList.add('hidden')"/>
              <div>
                <p class="text-xs font-semibold text-slate-600">Preview</p>
                <p class="text-xs text-slate-400 mt-0.5">Image will be loaded on the product page</p>
              </div>
            </div>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
              <i class="fas fa-info-circle mr-1 text-blue-400"></i>
              Paste an image URL (<code class="bg-slate-100 px-1 rounded">https://</code>) or an IPFS link
              (<code class="bg-slate-100 px-1 rounded">ipfs://</code>) for decentralized storage.
            </p>
          </div>

          <!-- Hidden field \u2014 always holds the primary/cover image for listProduct() -->
          <input type="hidden" id="prod-img-final"/>
        </div>

        <!-- Fee Breakdown Card -->
        <div class="card p-5 bg-slate-50 border-slate-200" id="fee-breakdown-card">
          <h4 class="font-bold text-slate-700 mb-3 flex items-center gap-2">
            <i class="fas fa-calculator text-red-500"></i> Listing Fee Breakdown
          </h4>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between text-slate-600">
              <span>Product Price</span><span id="fee-product-price">\u2014</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Platform Fee (2%)</span>
              <span id="fee-platform" class="text-red-600 font-semibold">\u2014</span>
            </div>
            <div class="flex justify-between text-slate-600">
              <span>Arc Network Gas Fee (est.)</span>
              <span id="fee-arc" class="text-slate-500">~0.001 USDC</span>
            </div>
            <div class="border-t border-slate-200 pt-2 flex justify-between font-bold text-slate-800">
              <span>You Receive (est.)</span>
              <span id="fee-you-receive" class="text-green-600">\u2014</span>
            </div>
          </div>
          <p class="text-xs text-slate-400 mt-3"><i class="fas fa-info-circle mr-1"></i>Platform fee is deducted from the sale amount when escrow is released.</p>
        </div>

        <!-- Escrow Policy -->
        <div class="card p-4 bg-red-50 border-red-100">
          <h4 class="font-bold text-red-800 mb-1 flex items-center gap-2"><i class="fas fa-shield-alt"></i> Escrow Policy</h4>
          <p class="text-sm text-red-700">All sales are protected by escrow via smart contract on Arc Network. Funds are only released after the buyer confirms delivery.</p>
        </div>

        <button onclick="listProduct()" id="sell-submit-btn" class="btn-primary w-full justify-center py-3 text-base">
          <i class="fas fa-tag mr-2"></i> List Product
        </button>
      </div>
    </div>
  </div>

  <script>
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  MULTI-IMAGE UPLOAD SYSTEM \u2014 max 5 images
  //  State: _miImages = [{ dataUrl, name, originalSize, compressedSize }]
  //  Cover = _miImages[0]
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  const MI_MAX         = 5;
  const MI_MAX_BYTES   = 5 * 1024 * 1024; // 5 MB per image
  const MI_VALID_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  let _miImages       = [];  // array of { dataUrl, name, origSize, compSize }
  let _miDragIdx      = -1;  // index of thumb being dragged
  let _miProcessing   = false;

  // \u2500\u2500 compress one File \u2192 dataURL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miCompress(file, maxW, maxH, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = ev => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // \u2500\u2500 process a batch of dropped / selected Files \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async function miHandleFiles(fileList) {
    if (_miProcessing) return;
    const files = Array.from(fileList);

    // Validate types first (show inline error)
    const invalidType = files.find(f => !MI_VALID_TYPES.includes(f.type));
    if (invalidType) {
      miShowError('Invalid file type "' + invalidType.name + '". Only JPG, PNG and WEBP are accepted.');
      return;
    }

    // Size check
    const tooBig = files.find(f => f.size > MI_MAX_BYTES);
    if (tooBig) {
      miShowError('"' + tooBig.name + '" exceeds the 5 MB limit (' + (tooBig.size / 1024 / 1024).toFixed(1) + ' MB).');
      return;
    }

    // Limit check
    const available = MI_MAX - _miImages.length;
    if (available <= 0) {
      miShowError('Maximum of ' + MI_MAX + ' images reached. Remove one before adding more.');
      return;
    }
    const batch = files.slice(0, available);
    if (files.length > available) {
      miShowError('Only ' + available + ' slot(s) remaining. ' + (files.length - available) + ' file(s) were ignored.');
    } else {
      miHideError();
    }

    // Duplicate check (by name + size)
    const existing = new Set(_miImages.map(i => i.name + ':' + i.origSize));
    const dupes = batch.filter(f => existing.has(f.name + ':' + f.size));
    if (dupes.length) {
      miShowError('Duplicate image(s) skipped: ' + dupes.map(d => d.name).join(', '));
    }
    const unique = batch.filter(f => !existing.has(f.name + ':' + f.size));
    if (!unique.length) return;

    // Show processing overlay
    _miProcessing = true;
    const overlay = document.getElementById('mi-processing-overlay');
    const procText = document.getElementById('mi-processing-text');
    if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }

    for (let i = 0; i < unique.length; i++) {
      const file = unique[i];
      if (procText) procText.textContent = 'Compressing ' + (i + 1) + '/' + unique.length + '\u2026';

      try {
        // First pass: 1200\xD71200 at 0.82
        let dataUrl = await miCompress(file, 1200, 1200, 0.82);
        // If still large, second pass
        if (dataUrl.length > 800 * 1024) {
          dataUrl = await miCompress(file, 900, 900, 0.65);
        }

        const origSize = file.size;
        const compSize = Math.round(dataUrl.length * 0.75);

        _miImages.push({ dataUrl, name: file.name, origSize, compSize });
      } catch (err) {
        console.error('[miHandleFiles] compress error:', err);
      }
    }

    _miProcessing = false;
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }

    miRender();
    miSyncFinal();
  }

  // \u2500\u2500 render the grid \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miRender() {
    const grid      = document.getElementById('mi-grid');
    const bar       = document.getElementById('mi-bar');
    const countEl   = document.getElementById('mi-count');
    const empty     = document.getElementById('mi-empty-state');
    const zone      = document.getElementById('mi-drop-zone');
    const n         = _miImages.length;

    if (!grid) return;

    // Toggle empty state vs grid
    if (n === 0) {
      grid.classList.add('hidden');
      bar.classList.add('hidden');
      empty.classList.remove('hidden');
      zone.classList.remove('has-images');
    } else {
      grid.classList.remove('hidden');
      bar.classList.remove('hidden');
      empty.classList.add('hidden');
      zone.classList.add('has-images');
    }

    if (countEl) countEl.textContent = n;

    // Build thumb nodes
    grid.innerHTML = '';

    _miImages.forEach((img, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'mi-thumb' + (idx === 0 ? ' is-cover' : '');
      thumb.dataset.idx = idx;
      thumb.draggable = true;

      // Drag events
      thumb.addEventListener('dragstart', e => {
        _miDragIdx = idx;
        setTimeout(() => thumb.classList.add('dragging'), 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      thumb.addEventListener('dragend', () => {
        thumb.classList.remove('dragging');
        document.querySelectorAll('.mi-thumb').forEach(t => t.classList.remove('drag-target'));
        _miDragIdx = -1;
      });
      thumb.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.mi-thumb').forEach(t => t.classList.remove('drag-target'));
        if (_miDragIdx !== -1 && _miDragIdx !== idx) thumb.classList.add('drag-target');
      });
      thumb.addEventListener('dragleave', () => thumb.classList.remove('drag-target'));
      thumb.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        thumb.classList.remove('drag-target');
        if (_miDragIdx === -1 || _miDragIdx === idx) return;
        // Reorder
        const moved = _miImages.splice(_miDragIdx, 1)[0];
        _miImages.splice(idx, 0, moved);
        miRender();
        miSyncFinal();
      });

      // Image element
      const image = document.createElement('img');
      image.src = img.dataUrl;
      image.alt = img.name;

      // Drag handle
      const handle = document.createElement('div');
      handle.className = 'mi-drag-handle';
      handle.innerHTML = '<i class="fas fa-grip-vertical"></i>';
      handle.title = 'Drag to reorder';

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'mi-remove';
      removeBtn.innerHTML = '<i class="fas fa-times"></i>';
      removeBtn.title = 'Remove image';
      removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        miRemove(idx);
      });

      // Cover badge (only index 0)
      if (idx === 0) {
        const badge = document.createElement('div');
        badge.className = 'mi-cover-badge';
        badge.textContent = 'Cover';
        thumb.appendChild(badge);
      }

      thumb.appendChild(image);
      thumb.appendChild(handle);
      thumb.appendChild(removeBtn);
      grid.appendChild(thumb);
    });

    // Add "+" slot if below max
    if (n < MI_MAX) {
      const addSlot = document.createElement('div');
      addSlot.className = 'mi-add-slot';
      addSlot.innerHTML = '<i class="fas fa-plus"></i><span>' + (n === 0 ? 'Add image' : 'Add more') + '</span>';
      addSlot.title = 'Add image (' + n + '/' + MI_MAX + ')';
      addSlot.addEventListener('click', e => {
        e.stopPropagation();
        document.getElementById('mi-file-input').click();
      });
      grid.appendChild(addSlot);
    }
  }

  // \u2500\u2500 remove by index \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miRemove(idx) {
    _miImages.splice(idx, 1);
    miRender();
    miSyncFinal();
    miHideError();
  }

  // \u2500\u2500 sync cover image \u2192 hidden field used by listProduct() \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miSyncFinal() {
    const field = document.getElementById('prod-img-final');
    if (field) field.value = _miImages.length > 0 ? _miImages[0].dataUrl : '';
  }

  // \u2500\u2500 zone click (only when clicking empty area, not on thumbs) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miZoneClick(e) {
    // Don't open picker if clicking a thumb or the add-slot (handled separately)
    if (e.target.closest('.mi-thumb') || e.target.closest('.mi-add-slot')) return;
    if (_miImages.length >= MI_MAX) return;
    document.getElementById('mi-file-input').click();
  }

  // \u2500\u2500 drag & drop on zone \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    // Only add visual if it's an external file drag (not a thumb reorder)
    if (_miDragIdx === -1) {
      document.getElementById('mi-drop-zone').classList.add('drag-over');
    }
  }
  function miDragLeave(e) {
    // Only remove if leaving the zone entirely
    if (!document.getElementById('mi-drop-zone').contains(e.relatedTarget)) {
      document.getElementById('mi-drop-zone').classList.remove('drag-over');
    }
  }
  function miDrop(e) {
    e.preventDefault();
    document.getElementById('mi-drop-zone').classList.remove('drag-over');
    if (_miDragIdx !== -1) return; // thumb reorder handled on thumb's own drop
    const files = e.dataTransfer.files;
    if (files && files.length) miHandleFiles(files);
  }

  // \u2500\u2500 error helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miShowError(msg) {
    const el = document.getElementById('mi-error');
    const tx = document.getElementById('mi-error-text');
    if (tx) tx.textContent = msg;
    if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; }
  }
  function miHideError() {
    const el = document.getElementById('mi-error');
    if (el) { el.classList.add('hidden'); el.style.display = 'none'; }
  }

  // \u2500\u2500 tab switcher \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function miSwitchTab(tab) {
    const isUpload = tab === 'upload';
    document.getElementById('img-panel-upload').classList.toggle('hidden', !isUpload);
    document.getElementById('img-panel-url').classList.toggle('hidden', isUpload);
    const tu = document.getElementById('tab-upload');
    const tl = document.getElementById('tab-url');
    const active   = 'px-3 py-1 rounded-md text-xs font-semibold transition-all bg-white text-slate-800 shadow-sm';
    const inactive = 'px-3 py-1 rounded-md text-xs font-semibold transition-all text-slate-500 hover:text-slate-700';
    if (tu) tu.className = isUpload ? active : inactive;
    if (tl) tl.className = isUpload ? inactive : active;
    if (!isUpload) {
      // Clear upload images from final when switching to URL tab
      document.getElementById('prod-img-final').value = '';
    } else {
      miSyncFinal();
    }
  }
  // Keep old name as alias (called from URL tab)
  function switchImgTab(tab) { miSwitchTab(tab); }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  listProduct \u2014 unchanged except reads prod-img-final (set by miSyncFinal)
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  async function listProduct() {
    const w = getStoredWallet();
    if (!w) { showToast('Connect a wallet first', 'error'); window.location.href = '/wallet'; return; }
    const name     = document.getElementById('prod-name').value.trim();
    const cat      = document.getElementById('prod-cat').value;
    const desc     = document.getElementById('prod-desc').value.trim();
    const priceVal = parseFloat(document.getElementById('prod-price').value);
    const token    = document.getElementById('prod-token').value;
    const stockVal = parseInt(document.getElementById('prod-stock').value) || 1;
    const img      = document.getElementById('prod-img-final').value.trim();

    if (!name || !cat || !desc || !priceVal) { showToast('Please fill in all required fields', 'error'); return; }
    if (priceVal <= 0) { showToast('Price must be greater than zero', 'error'); return; }

    const btn = document.getElementById('sell-submit-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Publishing\u2026'; }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name, description: desc, price: priceVal,
          token, image: img, category: cat, stock: stockVal,
          seller_id: w.address
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(data.error || 'Error publishing product', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-tag mr-2"></i> List Product'; }
        return;
      }
      showToast('Product listed successfully!', 'success');
      setTimeout(() => { window.location.href = '/marketplace'; }, 1200);
    } catch (err) {
      showToast('Network error. Please try again.', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-tag mr-2"></i> List Product'; }
    }
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  //  DOMContentLoaded \u2014 wallet check, fee breakdown, URL tab preview
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  document.addEventListener('DOMContentLoaded', async () => {
    checkNetworkStatus(document.getElementById('sell-network-status'));
    const w  = getStoredWallet();
    const wc = document.getElementById('sell-wallet-check');
    if (!w) {
      wc.innerHTML = '<div class="network-warning"><i class="fas fa-exclamation-triangle"></i>You need to connect a wallet to list products. <a href="/wallet" class="underline font-bold ml-1">Connect Wallet \u2192</a></div>';
    } else {
      wc.innerHTML = '<div class="network-ok"><i class="fas fa-check-circle text-green-600"></i>Seller: <span class="font-mono text-xs ml-1">' + w.address + '</span></div>';
    }

    // Fee breakdown live update
    function updateFeeBreakdown() {
      const priceEl = document.getElementById('prod-price');
      const tokenEl = document.getElementById('prod-token');
      if (!priceEl || !tokenEl) return;
      const p          = parseFloat(priceEl.value) || 0;
      const tok        = tokenEl.value || 'USDC';
      const platformFee= p * 0.02;
      const arcFee     = 0.001;
      const youReceive = Math.max(0, p - platformFee - arcFee);
      const fpEl   = document.getElementById('fee-product-price');
      const fplatEl= document.getElementById('fee-platform');
      const farcEl = document.getElementById('fee-arc');
      const fyoEl  = document.getElementById('fee-you-receive');
      if (fpEl)    fpEl.textContent   = p > 0 ? p.toFixed(6) + ' ' + tok : '\u2014';
      if (fplatEl) fplatEl.textContent= p > 0 ? platformFee.toFixed(6) + ' ' + tok : '\u2014';
      if (farcEl)  farcEl.textContent = '~0.001 ' + tok;
      if (fyoEl)   fyoEl.textContent  = p > 0 ? youReceive.toFixed(6) + ' ' + tok : '\u2014';
    }
    const priceInput  = document.getElementById('prod-price');
    const tokenSelect = document.getElementById('prod-token');
    if (priceInput)  priceInput.addEventListener('input', updateFeeBreakdown);
    if (tokenSelect) tokenSelect.addEventListener('change', updateFeeBreakdown);
    updateFeeBreakdown();

    // URL field live preview
    const urlInput = document.getElementById('prod-img');
    if (urlInput) {
      urlInput.addEventListener('input', function () {
        const val = this.value.trim();
        document.getElementById('prod-img-final').value = val;
        const wrap     = document.getElementById('img-url-preview-wrap');
        const previewEl= document.getElementById('img-url-preview');
        if (val && (val.startsWith('http') || val.startsWith('ipfs'))) {
          const src = val.startsWith('ipfs://') ? val.replace('ipfs://', 'https://ipfs.io/ipfs/') : val;
          previewEl.src = src;
          wrap.classList.remove('hidden');
        } else {
          wrap.classList.add('hidden');
        }
      });
    }

    // Init grid render (empty state)
    miRender();
  });
  </script>
  `);
}
function sellerDashboardPage() {
  return shell("Seller Dashboard", `
  <div class="max-w-5xl mx-auto px-4 py-8">

    <!-- Header -->
    <div class="flex items-center gap-4 mb-8">
      <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center text-white text-xl shadow-lg">
        <i class="fas fa-chart-line"></i>
      </div>
      <div>
        <h1 class="text-2xl font-extrabold text-slate-800">Seller Dashboard</h1>
        <p class="text-slate-500 text-sm">Manage your listings on Arc Network</p>
      </div>
      <a href="/sell" class="ml-auto btn-primary text-sm"><i class="fas fa-plus-circle mr-1"></i> New Listing</a>
    </div>

    <!-- Wallet check -->
    <div id="dash-wallet-check" class="mb-6"></div>

    <!-- Stats row -->
    <div id="dash-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"></div>

    <!-- Products table -->
    <div class="card p-6">
      <div class="flex items-center justify-between mb-5">
        <h2 class="font-bold text-slate-800 text-lg flex items-center gap-2">
          <i class="fas fa-boxes text-red-500"></i> My Products
        </h2>
        <div class="flex gap-2">
          <button onclick="filterDashProducts('all')" id="df-all" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white">All</button>
          <button onclick="filterDashProducts('active')" id="df-active" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Active</button>
          <button onclick="filterDashProducts('paused')" id="df-paused" class="dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">Paused</button>
        </div>
      </div>
      <div id="dash-products-container">
        <!-- populated by JS \u2014 no static spinner to avoid permanent loading state -->
      </div>
    </div>

  </div>

  <script>
  // \u2500\u2500 Seller Dashboard \u2014 fully functional logic \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  var _dashProducts = [];
  var _dashFilter   = 'all';
  var _dashAddress  = null;

  // \u2500\u2500 helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function _dashShowLoading(){
    var c = document.getElementById('dash-products-container');
    if(c) c.innerHTML =
      '<div class="text-center py-12">'
      +'<div class="loading-spinner-lg mx-auto mb-4"></div>'
      +'<p class="text-slate-400 text-sm">Loading your products\u2026</p>'
      +'</div>';
  }

  function _dashShowError(msg){
    var c = document.getElementById('dash-products-container');
    if(c) c.innerHTML =
      '<div class="p-8 text-center">'
      +'<i class="fas fa-exclamation-circle text-red-400 text-3xl mb-3"></i>'
      +'<p class="text-red-500 font-medium mb-1">Failed to load products</p>'
      +'<p class="text-slate-400 text-sm mb-4">'+(msg||'Network error. Please try again.')+'</p>'
      +'<button onclick="loadDashboardProducts(_dashAddress)" class="btn-primary text-sm mx-auto"><i class="fas fa-redo mr-1"></i> Retry</button>'
      +'</div>';
  }

  function _dashClearStats(){
    var s = document.getElementById('dash-stats');
    if(s) s.innerHTML = '';
  }

  // \u2500\u2500 init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function _dashInit(){
    var wallet = (typeof getStoredWallet === 'function') ? getStoredWallet() : null;
    var wc = document.getElementById('dash-wallet-check');
    var container = document.getElementById('dash-products-container');

    if(!wallet || !wallet.address){
      // No wallet \u2014 clear spinner, show connect prompt
      if(container) container.innerHTML = '';
      _dashClearStats();
      if(wc) wc.innerHTML =
        '<div class="card p-8 text-center">'
        +'<div class="empty-state">'
        +'<i class="fas fa-wallet"></i>'
        +'<h3 class="font-bold text-slate-600 mb-2">Connect Wallet</h3>'
        +'<p class="text-sm text-slate-400 mb-4">Connect your wallet to manage your listings on Arc Network.</p>'
        +'<a href="/wallet" class="btn-primary mx-auto"><i class="fas fa-wallet mr-1"></i> Connect Wallet</a>'
        +'</div></div>';
      return;
    }

    // Wallet connected \u2014 clear wallet-check banner if any
    if(wc) wc.innerHTML = '';
    _dashAddress = wallet.address;
    _dashShowLoading();
    loadDashboardProducts(wallet.address);
  }

  // Fire on DOMContentLoaded \u2014 guard against globalScript timing
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _dashInit);
  } else {
    _dashInit();
  }

  // \u2500\u2500 fetch products \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async function loadDashboardProducts(address){
    if(!address){ _dashShowError('No wallet address.'); return; }
    _dashAddress = address;
    _dashShowLoading();
    try {
      var res  = await fetch('/api/seller/'+encodeURIComponent(address)+'/products');
      if(!res.ok){ _dashShowError('Server returned '+res.status); return; }
      var data = await res.json();
      _dashProducts = Array.isArray(data.products) ? data.products : [];
      renderDashStats();
      renderDashProducts();
    } catch(e){
      _dashShowError(e && e.message ? e.message : 'Could not reach server.');
    }
  }

  // \u2500\u2500 stats \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function renderDashStats(){
    var total  = _dashProducts.length;
    var active = _dashProducts.filter(function(p){return p.status==='active';}).length;
    var paused = _dashProducts.filter(function(p){return p.status==='paused';}).length;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    var myAddr = wallet ? wallet.address.toLowerCase() : '';
    var allOrders = JSON.parse(localStorage.getItem('rh_orders')||'[]');
    var mySales = allOrders.filter(function(o){ return o.sellerAddress && o.sellerAddress.toLowerCase()===myAddr; });
    var stats = [
      {icon:'fas fa-boxes',    label:'Total Listings', value:total,          color:'text-red-600'},
      {icon:'fas fa-check-circle', label:'Active',     value:active,         color:'text-green-600'},
      {icon:'fas fa-pause-circle', label:'Paused',     value:paused,         color:'text-amber-600'},
      {icon:'fas fa-shopping-bag', label:'Total Sales',value:mySales.length, color:'text-blue-600'},
    ];
    var el = document.getElementById('dash-stats');
    if(!el) return;
    el.innerHTML = stats.map(function(s){
      return '<div class="card p-5 text-center">'
        +'<div class="'+s.color+' text-2xl font-extrabold mb-1">'+s.value+'</div>'
        +'<div class="text-xs text-slate-500 font-medium"><i class="'+s.icon+' mr-1"></i>'+s.label+'</div>'
        +'</div>';
    }).join('');
  }

  // \u2500\u2500 filter buttons \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function filterDashProducts(f){
    _dashFilter = f;
    document.querySelectorAll('.dash-filter-btn').forEach(function(b){
      b.className = 'dash-filter-btn px-3 py-1.5 rounded-lg text-xs font-semibold '
        +(b.id==='df-'+f ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
    });
    renderDashProducts();
  }

  // \u2500\u2500 render table \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  function renderDashProducts(){
    var container = document.getElementById('dash-products-container');
    if(!container) return;

    var list = _dashFilter==='all'
      ? _dashProducts
      : _dashProducts.filter(function(p){ return p.status===_dashFilter; });

    // Empty states
    if(_dashProducts.length===0){
      container.innerHTML =
        '<div class="text-center py-12">'
        +'<div class="empty-state">'
        +'<i class="fas fa-store"></i>'
        +'<h3 class="font-bold text-slate-600 mb-2">No products listed yet</h3>'
        +'<p class="text-sm text-slate-400 mb-4">Start selling by listing your first product on Arc Network.</p>'
        +'<a href="/sell" class="btn-primary mx-auto"><i class="fas fa-plus-circle mr-1"></i> List a Product</a>'
        +'</div></div>';
      return;
    }
    if(list.length===0){
      container.innerHTML =
        '<div class="text-center py-10 text-slate-400 text-sm">'
        +'<i class="fas fa-filter mr-2"></i>No <strong>'+_dashFilter+'</strong> products found.'
        +'</div>';
      return;
    }

    // Responsive table
    container.innerHTML =
      '<div class="overflow-x-auto">'
      +'<table class="w-full text-sm border-collapse">'
      +'<thead><tr class="border-b border-slate-100">'
      +'<th class="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th>'
      +'<th class="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Category</th>'
      +'<th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Price</th>'
      +'<th class="text-center py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stock</th>'
      +'<th class="text-center py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>'
      +'<th class="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>'
      +'</tr></thead>'
      +'<tbody>'
      +list.map(function(p){
        var statusBadge = p.status==='active'
          ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>'
          : p.status==='paused'
            ? '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Paused</span>'
            : '<span class="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">Deleted</span>';
        var imgEl = p.image
          ? '<img src="'+p.image+'" class="w-10 h-10 rounded-lg object-cover mr-3 shrink-0" onerror="this.style.display='none'">'
          : '<div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center mr-3 shrink-0"><i class="fas fa-image text-slate-300"></i></div>';
        var actionBtns = '';
        if(p.status==='active'){
          actionBtns += '<button onclick="dashPauseProduct(''+p.id+'')" class="text-amber-600 hover:text-amber-800 text-xs font-semibold px-2 py-1 rounded hover:bg-amber-50" title="Pause Listing"><i class="fas fa-pause mr-1"></i>Pause</button>';
        }
        if(p.status==='paused'){
          actionBtns += '<button onclick="dashResumeProduct(''+p.id+'')" class="text-green-600 hover:text-green-800 text-xs font-semibold px-2 py-1 rounded hover:bg-green-50" title="Resume Listing"><i class="fas fa-play mr-1"></i>Resume</button>';
        }
        actionBtns += '<a href="/product/'+p.id+'" class="text-blue-600 hover:text-blue-800 text-xs font-semibold px-2 py-1 rounded hover:bg-blue-50" title="View Product"><i class="fas fa-eye mr-1"></i>View</a>';
        actionBtns += '<button onclick="dashDeleteProduct(''+p.id+'')" class="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50" title="Delete Product"><i class="fas fa-trash mr-1"></i>Delete</button>';
        return '<tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">'
          +'<td class="py-3 px-2"><div class="flex items-center">'+imgEl
          +'<div><p class="font-semibold text-slate-800 text-xs leading-tight line-clamp-2 max-w-xs">'+((p.title||'Untitled').replace(/</g,'&lt;'))+'</p>'
          +'<p class="text-slate-400 text-xs font-mono">'+p.id+'</p></div></div></td>'
          +'<td class="py-3 px-2 text-slate-500 text-xs hidden md:table-cell">'+(p.category||'Other')+'</td>'
          +'<td class="py-3 px-2 text-right font-bold text-red-600">'+parseFloat(p.price||0).toFixed(2)
          +' <span class="text-xs font-normal text-slate-500">'+(p.token||'USDC')+'</span></td>'
          +'<td class="py-3 px-2 text-center text-slate-600">'+(p.stock||0)+'</td>'
          +'<td class="py-3 px-2 text-center">'+statusBadge+'</td>'
          +'<td class="py-3 px-2 text-right"><div class="flex items-center justify-end gap-1">'+actionBtns+'</div></td>'
          +'</tr>';
      }).join('')
      +'</tbody></table></div>';
  }

  // \u2500\u2500 action handlers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async function dashPauseProduct(productId){
    if(!confirm('Pause this listing? It will be hidden from the marketplace but not deleted.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId+'/status',{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address, status:'paused'})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to pause','error'); return; }
      showToast('Listing paused \u2014 hidden from marketplace','info');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }

  async function dashResumeProduct(productId){
    if(!confirm('Resume this listing? It will be visible in the marketplace again.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId+'/status',{
        method:'PATCH', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address, status:'active'})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to resume','error'); return; }
      showToast('Listing is now active on the marketplace','success');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }

  async function dashDeleteProduct(productId){
    if(!confirm('Delete this product? It will be permanently removed. This cannot be undone.')) return;
    var wallet = (typeof getStoredWallet==='function') ? getStoredWallet() : null;
    if(!wallet){ showToast('Connect wallet first','error'); return; }
    try {
      var res = await fetch('/api/products/'+productId,{
        method:'DELETE', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({seller_id:wallet.address})
      });
      var data = await res.json();
      if(!res.ok){ showToast(data.error||'Failed to delete','error'); return; }
      showToast('Product deleted successfully','success');
      await loadDashboardProducts(wallet.address);
    } catch(e){ showToast('Network error','error'); }
  }
  </script>
  `);
}
function profilePage() {
  return shell("Profile", `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-6 flex items-center gap-3">
      <i class="fas fa-user text-red-500"></i> My Profile
    </h1>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="card p-6">
        <div class="text-center mb-6">
          <div class="w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-red-700 flex items-center justify-center text-white text-3xl font-bold mx-auto mb-3">
            <i class="fas fa-user"></i>
          </div>
          <p class="font-bold text-slate-800" id="prof-address">Not connected</p>
          <div class="mt-2" id="prof-network-badge"></div>
        </div>
        <nav class="sidebar-nav space-y-1">
          <a href="/profile" class="active"><i class="fas fa-user w-4"></i> Profile</a>
          <a href="/orders"><i class="fas fa-box w-4"></i> My Orders</a>
          <a href="/wallet"><i class="fas fa-wallet w-4"></i> Wallet</a>
          <a href="/sell"><i class="fas fa-store w-4"></i> Sell</a>
          <a href="/disputes"><i class="fas fa-gavel w-4"></i> Disputes</a>
          <a href="/notifications"><i class="fas fa-bell w-4"></i> Notifications</a>
        </nav>
      </div>
      <div class="md:col-span-2 space-y-5">
        <div class="card p-6">
          <h2 class="font-bold text-slate-800 text-lg mb-4">Personal Information</h2>
          <div class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label><input type="text" placeholder="Your name" class="input"/></div>
              <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="your@email.com" class="input"/></div>
            </div>
            <div><label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label><input type="text" placeholder="Street, City, Country" class="input"/></div>
            <button onclick="showToast('Profile saved locally','success')" class="btn-primary"><i class="fas fa-save"></i> Save Changes</button>
          </div>
        </div>
        <!-- Wallet on-chain info -->
        <div class="card p-5" id="prof-wallet-card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-bold text-slate-800 flex items-center gap-2">
              <i class="fas fa-wallet text-red-500"></i> Arc Network Wallet
            </h3>
            <a href="/wallet" class="text-red-600 text-sm hover:underline">Manage \u2192</a>
          </div>
          <div id="prof-wallet-info" class="text-slate-400 text-sm">Loading\u2026</div>
        </div>
        <!-- Stats (from localStorage orders) -->
        <div class="grid grid-cols-3 gap-4" id="prof-stats">
          <div class="card p-4 text-center"><i class="fas fa-box text-red-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-orders">0</p><p class="text-slate-400 text-xs">Orders</p></div>
          <div class="card p-4 text-center"><i class="fas fa-coins text-red-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-spent">0</p><p class="text-slate-400 text-xs">USDC Spent</p></div>
          <div class="card p-4 text-center"><i class="fas fa-check-circle text-green-500 text-xl mb-2"></i><p class="text-2xl font-extrabold text-slate-800" id="stat-completed">0</p><p class="text-slate-400 text-xs">Completed</p></div>
        </div>
      </div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', async () => {
    const w=getStoredWallet();
    if(w){
      document.getElementById('prof-address').textContent=w.address.substring(0,10)+'\u2026'+w.address.slice(-6);
      document.getElementById('prof-network-badge').innerHTML='<span class="arc-badge text-xs"><i class="fas fa-network-wired text-xs"></i> Arc Testnet</span>';
      document.getElementById('prof-wallet-info').innerHTML=
        '<div class="space-y-1">'
        +'<p class="text-xs text-slate-500">Address</p>'
        +'<p class="font-mono text-xs text-slate-700 break-all">'+w.address+'</p>'
        +'<a href="${ARC.explorer}/address/'+w.address+'" target="_blank" class="text-blue-600 text-xs hover:underline flex items-center gap-1 mt-1">'
        +'<i class="fas fa-external-link-alt text-xs"></i> View on Arc Explorer</a></div>';
      const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]').filter(o=>o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
      document.getElementById('stat-orders').textContent=orders.length;
      document.getElementById('stat-spent').textContent=(orders.reduce((s,o)=>s+(o.amount||0),0)).toFixed(2);
      document.getElementById('stat-completed').textContent=orders.filter(o=>o.status==='completed').length;
    } else {
      document.getElementById('prof-wallet-info').innerHTML='<a href="/wallet" class="text-red-600 hover:underline">Connect wallet \u2192</a>';
    }
  });
  </script>
  `);
}
function registerPage() {
  return shell("Register", `
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-red-50 to-white">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <a href="/" class="flex items-center justify-center gap-2 mb-4">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
          </div>
          <span class="font-extrabold text-xl text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Create Account</h1>
        <p class="text-slate-500 text-sm">Join Shukly Store on Arc Network</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-sm font-medium text-slate-700 mb-1">First Name</label><input type="text" placeholder="John" class="input"/></div>
            <div><label class="block text-sm font-medium text-slate-700 mb-1">Last Name</label><input type="text" placeholder="Doe" class="input"/></div>
          </div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="john@email.com" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Shipping Address</label><input type="text" placeholder="Street, City, Country" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Password</label><input type="password" placeholder="Min 8 characters" class="input"/></div>
          <div class="border-t pt-4">
            <p class="text-sm font-semibold text-slate-700 mb-3">Wallet Setup <span class="text-red-500">*</span></p>
            <div class="grid grid-cols-1 gap-3 max-w-xs mx-auto">
              <button onclick="connectWallet('metamask').then(w=>{if(w)showToast('MetaMask connected!','success')})" class="card p-3 text-center hover:border-orange-300 hover:bg-orange-50 transition-all">
                <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-7 h-7 mx-auto mb-1"/>
                <p class="font-semibold text-slate-700 text-sm">MetaMask</p>
                <p class="text-slate-400 text-xs">Arc Testnet</p>
              </button>
            </div>
          </div>
          <label class="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
            <input type="checkbox" class="accent-red-600 w-4 h-4"/>
            I agree to the <a href="/terms" class="text-red-600 hover:underline">Terms of Service</a> and <a href="/privacy" class="text-red-600 hover:underline">Privacy Policy</a>
          </label>
          <button onclick="showToast('Account created! Now connect your wallet.','success')" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-user-plus"></i> Create Account
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">Already have an account? <a href="/login" class="text-red-600 hover:underline font-medium">Sign in</a></p>
      </div>
    </div>
  </div>
  `);
}
function loginPage() {
  return shell("Login", `
  <div class="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-red-50 to-white">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <a href="/" class="flex items-center justify-center gap-2 mb-4">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-800 flex items-center justify-center shadow">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
          </div>
          <span class="font-extrabold text-xl text-slate-800">Shukly<span class="text-amber-500"> Store</span></span>
        </a>
        <h1 class="text-2xl font-extrabold text-slate-800 mb-1">Welcome Back</h1>
        <p class="text-slate-500 text-sm">Sign in to Shukly Store on Arc Network</p>
      </div>
      <div class="card p-8">
        <div class="space-y-4">
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Email</label><input type="email" placeholder="john@email.com" class="input"/></div>
          <div><label class="block text-sm font-medium text-slate-700 mb-1">Password</label><input type="password" placeholder="Your password" class="input"/></div>
          <button onclick="showToast('Signed in!','success');setTimeout(()=>window.location.href='/',1000)" class="btn-primary w-full justify-center py-3">
            <i class="fas fa-sign-in-alt"></i> Sign In
          </button>
          <div class="relative flex items-center gap-3">
            <div class="flex-1 h-px bg-slate-200"></div><span class="text-slate-400 text-xs">or</span><div class="flex-1 h-px bg-slate-200"></div>
          </div>
          <button onclick="connectWallet('metamask').then(w=>{if(w){showToast('Signed in with MetaMask!','success');setTimeout(()=>window.location.href='/',1000)}})" class="btn-secondary w-full justify-center py-2.5 text-sm">
            <img src="https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg" class="w-5 h-5"/>
            Sign in with MetaMask (Arc Testnet)
          </button>
        </div>
        <p class="text-center text-sm text-slate-500 mt-4">Don't have an account? <a href="/register" class="text-red-600 hover:underline font-medium">Create one</a></p>
      </div>
    </div>
  </div>
  `);
}
function disputesPage() {
  return shell("Disputes", `
  <div class="max-w-4xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-gavel text-red-500"></i> Dispute Resolution
    </h1>
    <p class="text-slate-500 mb-6">Open disputes are reviewed by Shukly Store governance. Escrow funds remain locked on Arc Network until resolved.</p>

    <!-- Fund-lock info banner -->
    <div class="flex items-start gap-3 p-4 mb-6 rounded-xl" style="background:#fef2f2;border:1px solid #fecaca;">
      <i class="fas fa-lock text-red-500 mt-0.5 flex-shrink-0"></i>
      <div>
        <p class="font-semibold text-red-800 text-sm mb-1">Funds Are Locked During Disputes</p>
        <p class="text-red-700 text-xs">USDC/EURC stays locked in the Arc Network escrow contract while a dispute is active. No release or transfer is possible until the dispute is resolved by both parties.</p>
      </div>
    </div>

    <!-- disputes list rendered by disputes.js -->
    <div id="disputes-container">
      <div class="text-center py-8">
        <div class="loading-spinner-lg mx-auto mb-4"></div>
        <p class="text-slate-400">Loading disputes\u2026</p>
      </div>
    </div>

    <!-- modal root for evidence viewer -->
    <div id="disputes-modal-root"></div>
  </div>
  <!-- Disputes logic is in /static/disputes.js (no inline script) -->
  <script src="/static/disputes.js" defer></script>
  `);
}
function notificationsPage() {
  return shell("Notifications", `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-slate-800 flex items-center gap-3">
        <i class="fas fa-bell text-red-500"></i> Notifications
      </h1>
      <button onclick="clearNotifs()" class="btn-secondary text-sm">Mark all read</button>
    </div>
    <div id="notif-list">
      <div class="text-center py-8"><div class="loading-spinner-lg mx-auto mb-4"></div><p class="text-slate-400">Loading\u2026</p></div>
    </div>
  </div>
  <script>
  document.addEventListener('DOMContentLoaded', () => {
    const w=getStoredWallet();
    const container=document.getElementById('notif-list');
    const orders=JSON.parse(localStorage.getItem('rh_orders')||'[]');
    const notifs=[];

    if(w){
      const myOrders=orders.filter(o=>o.buyerAddress&&o.buyerAddress.toLowerCase()===w.address.toLowerCase());
      myOrders.slice(-5).reverse().forEach(o=>{
        notifs.push({icon:'fas fa-lock',color:'bg-yellow-100 text-yellow-600',title:'Escrow Created',msg:'Order '+o.id+' locked on Arc Network',time:new Date(o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='shipped') notifs.push({icon:'fas fa-shipping-fast',color:'bg-blue-100 text-blue-600',title:'Order Shipped',msg:'Order '+o.id+' has been shipped',time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='completed') notifs.push({icon:'fas fa-check-circle',color:'bg-green-100 text-green-600',title:'Escrow Released',msg:'Funds released for order '+o.id,time:new Date(o.updatedAt||o.createdAt).toLocaleString(),url:'/orders/'+o.id});
        if(o.status==='dispute') notifs.push({icon:'fas fa-gavel',color:'bg-red-100 text-red-600',title:'Dispute Opened',msg:'Dispute opened for order '+o.id+'. Funds locked.',time:new Date(o.disputedAt||o.createdAt).toLocaleString(),url:'/disputes'});
      });
    }

    if(!notifs.length){
      container.innerHTML='<div class="card p-12 text-center"><div class="empty-state"><i class="fas fa-bell-slash"></i><h3 class="font-bold text-slate-600 mb-2">No Notifications</h3><p class="text-sm">Notifications are triggered by real Arc Network events \u2014 escrow creation, shipments, and releases.</p></div></div>';
      return;
    }
    container.innerHTML=notifs.map(n=>
      '<a href="'+(n.url||'#')+'" class="notification-item flex items-start gap-4 cursor-pointer hover:bg-red-50 transition-colors block">'
      +'<div class="w-10 h-10 rounded-full '+n.color+' flex items-center justify-center shrink-0"><i class="'+n.icon+' text-sm"></i></div>'
      +'<div class="flex-1"><p class="font-semibold text-slate-800 text-sm">'+n.title+'</p>'
      +'<p class="text-slate-500 text-xs">'+n.msg+'</p>'
      +'<p class="text-slate-300 text-xs mt-1">'+n.time+'</p></div>'
      +'<div class="w-2 h-2 rounded-full bg-red-500 mt-2 shrink-0"></div></a>'
    ).join('');
  });
  function clearNotifs(){ showToast('All notifications marked as read','info'); document.querySelectorAll('.notification-item .rounded-full.bg-red-500').forEach(el=>el.remove()); }
  </script>
  `);
}
function termsPage() {
  return shell("Terms of Service", `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-file-alt"></i></div>
        <div>
          <h1>Terms of Service</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 \xB7 Shukly Store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-exclamation-circle" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Important:</strong> Shukly Store is a testnet demonstration project. No real funds, products, or legal obligations are involved.</span>
      </div>

      <h2>1. Acceptance of Terms</h2>
      <p>By accessing or using Shukly Store ("the Platform"), you agree to be bound by these Terms of Service. If you do not agree, please do not use the Platform.</p>

      <h2>2. Nature of the Platform</h2>
      <p>Shukly Store is an open-source, decentralized marketplace demonstration running on the Arc Network testnet. It is provided for educational and testing purposes only. No real monetary transactions occur. All products listed are illustrative and not real.</p>

      <h2>3. Testnet Environment</h2>
      <p>All transactions on Shukly Store are executed on Arc Testnet (Chain ID: 5042002). Testnet tokens (USDC, EURC) have no real monetary value. We are not responsible for any loss of testnet assets.</p>

      <h2>4. Wallet & Private Keys</h2>
      <p>Shukly Store operates as a non-custodial platform. We do not store, collect, or have access to your private keys, seed phrases, or wallet credentials. You are solely responsible for the security of your wallet. Private keys are generated and stored exclusively in your browser.</p>

      <h2>5. No Financial Advice</h2>
      <p>Nothing on this Platform constitutes financial, investment, legal, or tax advice. All content is for informational and demonstration purposes only.</p>

      <h2>6. Prohibited Use</h2>
      <ul>
        <li>Using the Platform for any illegal purpose</li>
        <li>Attempting to exploit or manipulate smart contracts</li>
        <li>Impersonating any person or entity</li>
        <li>Introducing malware or harmful code</li>
      </ul>

      <h2>7. Disclaimer of Warranties</h2>
      <p>The Platform is provided "as is" without warranties of any kind. We do not guarantee uninterrupted access, accuracy of data, or fitness for a particular purpose.</p>

      <h2>8. Limitation of Liability</h2>
      <p>To the maximum extent permitted by law, Shukly Store and its contributors shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Platform.</p>

      <h2>9. Changes to Terms</h2>
      <p>We reserve the right to modify these Terms at any time. Continued use of the Platform after changes constitutes acceptance of the new Terms.</p>

      <h2>10. Contact</h2>
      <p>For questions about these Terms, please open an issue on our <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="text-red-600 hover:underline">GitHub repository</a>.</p>

      <div class="flex gap-3 mt-8">
        <a href="/privacy" class="btn-secondary text-sm"><i class="fas fa-lock"></i> Privacy Policy</a>
        <a href="/disclaimer" class="btn-secondary text-sm"><i class="fas fa-exclamation-triangle"></i> Disclaimer</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `);
}
function privacyPage() {
  return shell("Privacy Policy", `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-600"><i class="fas fa-lock"></i></div>
        <div>
          <h1>Privacy Policy</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 \xB7 Shukly Store</p>
        </div>
      </div>

      <div class="trust-box mb-6">
        <i class="fas fa-shield-alt" style="color:#16a34a;flex-shrink:0"></i>
        <span><strong>Privacy first:</strong> Shukly Store does not collect personal data. Your wallet keys never leave your browser. We have no backend user database.</span>
      </div>

      <h2>1. Information We Do NOT Collect</h2>
      <ul>
        <li>Private keys or seed phrases (these stay in your browser only)</li>
        <li>Personal identification information (name, email, address)</li>
        <li>Financial data or payment information</li>
        <li>Browsing history or tracking cookies</li>
      </ul>

      <h2>2. Information Stored Locally</h2>
      <p>The following data is stored exclusively in your browser's localStorage and never transmitted to our servers:</p>
      <ul>
        <li>Encrypted wallet data (address only \u2014 private key encrypted with your password)</li>
        <li>Shopping cart contents</li>
        <li>Order metadata (transaction hashes, escrow status)</li>
        <li>UI preferences (e.g., banner dismissed state)</li>
      </ul>

      <h2>3. Blockchain Data</h2>
      <p>When you connect a wallet or execute transactions, your public wallet address and transaction data are visible on the Arc Network blockchain. Blockchain data is public by nature and cannot be deleted.</p>

      <h2>4. Third-Party Services</h2>
      <p>Shukly Store may interact with the following third-party services:</p>
      <ul>
        <li><strong>Arc Network RPC</strong> (rpc.testnet.arc.network) \u2014 for blockchain queries</li>
        <li><strong>Arc Explorer</strong> (testnet.arcscan.app) \u2014 public blockchain explorer</li>
        <li><strong>Circle Faucet</strong> (faucet.circle.com) \u2014 for testnet tokens</li>
        <li><strong>CDN resources</strong> (Tailwind, FontAwesome, ethers.js) \u2014 loaded from public CDNs</li>
      </ul>

      <h2>5. No Tracking</h2>
      <p>We do not use analytics tools, advertising pixels, or any form of user tracking.</p>

      <h2>6. Security</h2>
      <p>Wallet private keys are encrypted client-side using your chosen password before being stored in localStorage. We recommend using a strong, unique password. Never share your seed phrase or private key with anyone.</p>

      <h2>7. Children's Privacy</h2>
      <p>Shukly Store is not directed at children under 13. We do not knowingly collect information from children.</p>

      <h2>8. Contact</h2>
      <p>For privacy-related questions, please open an issue on our <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="text-red-600 hover:underline">GitHub repository</a>.</p>

      <div class="flex gap-3 mt-8">
        <a href="/terms" class="btn-secondary text-sm"><i class="fas fa-file-alt"></i> Terms of Service</a>
        <a href="/disclaimer" class="btn-secondary text-sm"><i class="fas fa-exclamation-triangle"></i> Disclaimer</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `);
}
function disclaimerPage() {
  return shell("Disclaimer", `
  <div class="max-w-3xl mx-auto px-4 py-12 legal-page">
    <div class="card p-8">
      <div class="flex items-center gap-3 mb-6">
        <div class="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center text-yellow-600"><i class="fas fa-exclamation-triangle"></i></div>
        <div>
          <h1>Disclaimer</h1>
          <p class="text-slate-400 text-sm">Last updated: January 2024 \xB7 Shukly Store</p>
        </div>
      </div>

      <div class="demo-disclaimer mb-6">
        <i class="fas fa-flask" style="color:#d97706;flex-shrink:0"></i>
        <span><strong>Testnet only:</strong> This application runs exclusively on Arc Testnet. No real money, products, or services are involved.</span>
      </div>

      <h2>General Disclaimer</h2>
      <p>Shukly Store is an open-source, experimental decentralized application (dApp) built for demonstration and educational purposes. It is not a licensed financial service, marketplace, exchange, or business entity.</p>

      <h2>No Real Products</h2>
      <p>All products displayed on Shukly Store are entirely illustrative. They do not represent real items available for purchase. No physical or digital goods are sold through this platform.</p>

      <h2>No Real Funds</h2>
      <p>All tokens used on Shukly Store (USDC, EURC) are testnet tokens with zero monetary value. They cannot be exchanged for real currency. Arc Testnet tokens are only for testing purposes.</p>

      <h2>Smart Contract Risk</h2>
      <p>Smart contracts used in Shukly Store are deployed on testnet and have not undergone formal security audits. Do not interact with them using mainnet wallets or real funds.</p>

      <h2>No Financial Advice</h2>
      <p>Nothing on this platform constitutes financial, investment, legal, or tax advice. The platform does not recommend any investment strategy or financial product.</p>

      <h2>Wallet Security</h2>
      <p>You are solely responsible for the security of your wallet and any credentials you use. Shukly Store does not have access to your private keys, but your browser-stored wallet is only as secure as your device and password.</p>

      <h2>Availability</h2>
      <p>This platform may be modified, suspended, or discontinued at any time without notice. It is provided on a best-effort basis with no uptime guarantees.</p>

      <h2>External Links</h2>
      <p>Links to external sites (Arc Docs, Circle Faucet, GitHub) are provided for convenience. We are not responsible for the content or privacy practices of third-party websites.</p>

      <div class="flex gap-3 mt-8">
        <a href="/terms" class="btn-secondary text-sm"><i class="fas fa-file-alt"></i> Terms of Service</a>
        <a href="/privacy" class="btn-secondary text-sm"><i class="fas fa-lock"></i> Privacy Policy</a>
        <a href="/" class="btn-primary text-sm"><i class="fas fa-home"></i> Back to Home</a>
      </div>
    </div>
  </div>
  `);
}
function aboutPage() {
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "Shukly Store",
    "description": "Testnet-only application built on Arc Network for experimental and development purposes. No real financial transactions or assets involved.",
    "applicationCategory": "FinanceApplication",
    "operatingSystem": "Web",
    "offers": {
      "@type": "Offer",
      "price": "0",
      "priceCurrency": "USD"
    }
  });
  return shell(
    "About Us",
    `
  <!-- \u2500\u2500 About Us Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
  <div class="max-w-4xl mx-auto px-4 py-10">

    <!-- \u2500\u2500 Hero banner \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border-radius:24px;padding:48px 40px;margin-bottom:32px;position:relative;overflow:hidden;">
      <div style="position:absolute;top:-40px;right:-40px;width:220px;height:220px;background:radial-gradient(circle,rgba(220,38,38,.18) 0%,transparent 70%);pointer-events:none;"></div>
      <div style="position:absolute;bottom:-30px;left:-30px;width:160px;height:160px;background:radial-gradient(circle,rgba(245,158,11,.1) 0%,transparent 70%);pointer-events:none;"></div>
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;position:relative;">
        <div style="width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#dc2626,#991b1b);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(220,38,38,.35);flex-shrink:0;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/></svg>
        </div>
        <div>
          <h1 style="font-size:2rem;font-weight:900;color:#fff;margin:0;line-height:1.1;">About Us</h1>
          <p style="color:#94a3b8;font-size:.9rem;margin:4px 0 0;">Shukly Store \xB7 Testnet Application on Arc Network</p>
        </div>
      </div>
      <!-- Trust badge strip -->
      <div style="display:flex;flex-wrap:wrap;gap:10px;position:relative;">
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.25);color:#4ade80;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-flask"></i> Testnet Environment Only
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:#60a5fa;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-shield-alt"></i> Security-Focused Development
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.25);color:#c084fc;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-wallet"></i> Non-Custodial
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.25);color:#fbbf24;border-radius:999px;padding:5px 14px;font-size:.75rem;font-weight:600;">
          <i class="fas fa-ban"></i> No Real Assets
        </span>
      </div>
    </div>

    <!-- \u2500\u2500 Important notice \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <div class="card p-5 mb-6" style="background:#fffbeb;border:1.5px solid #fde68a;">
      <div class="flex items-start gap-3">
        <i class="fas fa-exclamation-triangle text-amber-500 text-xl mt-0.5 shrink-0"></i>
        <div>
          <p class="font-bold text-amber-800 text-sm mb-1">Important Notice \u2014 Testnet Environment</p>
          <p class="text-amber-700 text-sm leading-relaxed">
            This platform operates exclusively within a <strong>testnet environment</strong> using Arc Network's test infrastructure.
            <strong>No real funds</strong> are involved at any point. All balances, assets, and transactions are simulated or
            testnet-based only. This is strictly an experimental and development platform.
          </p>
        </div>
      </div>
    </div>

    <!-- \u2500\u2500 Main grid \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
    <div style="display:grid;grid-template-columns:1fr;gap:24px;">

      <!-- About the Platform -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#dbeafe,#bfdbfe);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-info-circle text-blue-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">About This Platform</h2>
        </div>
        <div style="space-y:12px">
          <p class="text-slate-600 text-sm leading-relaxed mb-3">
            Shukly Store was built by an <strong>independent developer</strong> using the <strong>Arc Network</strong> \u2014 Circle's
            stablecoin-native Layer 1 blockchain. The purpose of this website is strictly for
            <strong>testing and experimental use only</strong>.
          </p>
          <p class="text-slate-600 text-sm leading-relaxed mb-3">
            The platform operates exclusively on the <strong>Arc Network testnet</strong> (Chain ID: 5042002).
            No real funds are involved. No real financial transactions occur.
            All balances, assets, and interactions are <strong>simulated or testnet-based only</strong>.
          </p>
          <p class="text-slate-600 text-sm leading-relaxed">
            This website was developed using <strong>Genspark</strong>, with a strong focus on
            <strong>performance and security</strong>. The platform includes protection against attacks,
            exploits, and malicious activity.
          </p>
        </div>
        <!-- Info chips -->
        <div class="flex flex-wrap gap-2 mt-4">
          <span class="tag"><i class="fas fa-network-wired mr-1"></i>Arc Testnet \xB7 Chain 5042002</span>
          <span class="tag"><i class="fas fa-code mr-1"></i>Built with Genspark</span>
          <span class="tag"><i class="fas fa-lock mr-1"></i>Non-custodial wallet</span>
        </div>
      </section>

      <!-- Two-column grid for medium+ screens -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">

        <!-- Security & Transparency -->
        <section class="card p-6">
          <div class="flex items-center gap-3 mb-4">
            <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#dcfce7,#bbf7d0);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-shield-alt text-green-600"></i>
            </div>
            <h2 class="text-lg font-bold text-slate-800 m-0">Security &amp; Transparency</h2>
          </div>
          <ul class="space-y-3 text-sm text-slate-600" style="list-style:none;padding:0;margin:0;">
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">No storage of sensitive user data</strong> \u2014 we do not collect, store, or transmit private keys or personal information.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">No automatic wallet transactions</strong> \u2014 every on-chain action requires explicit user confirmation.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Users have full control of their wallets</strong> \u2014 private keys are generated client-side and never leave your device.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Platform is for testing and demo purposes only</strong> \u2014 not a commercial service.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Security-focused development</strong> \u2014 HTTP security headers, CSP, HSTS, and anti-abuse measures active.</span>
            </li>
            <li class="flex items-start gap-2.5">
              <i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i>
              <span><strong class="text-slate-700">Protection against attacks &amp; exploits</strong> \u2014 malicious activity is monitored and blocked.</span>
            </li>
          </ul>
        </section>

        <!-- Compliance & Trust -->
        <section class="card p-6">
          <div class="flex items-center gap-3 mb-4">
            <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#fce7f3,#fbcfe8);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i class="fas fa-certificate text-pink-600"></i>
            </div>
            <h2 class="text-lg font-bold text-slate-800 m-0">Compliance &amp; Trust</h2>
          </div>
          <div class="space-y-3 text-sm text-slate-600">
            <div class="flex items-start gap-2.5">
              <i class="fas fa-flask text-purple-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Testnet environment</strong><br/>Operates exclusively on Arc Network testnet. No mainnet activity occurs.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-ban text-red-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">No real assets</strong><br/>All USDC/EURC balances are testnet tokens with no monetary value.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-user-shield text-blue-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Non-custodial architecture</strong><br/>We have zero access to user funds or private keys at any time.</div>
            </div>
            <div class="flex items-start gap-2.5">
              <i class="fas fa-code-branch text-green-500 mt-0.5 shrink-0"></i>
              <div><strong class="text-slate-700">Open source</strong><br/>Source code is publicly available for independent review and audit.</div>
            </div>
          </div>
        </section>
      </div>

      <!-- Technology Stack -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-5">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#e0e7ff,#c7d2fe);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-layer-group text-indigo-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Technology Stack</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;">
          ${[
      { icon: "fas fa-network-wired", color: "#3b82f6", label: "Blockchain", value: "Arc Network Testnet (EVM)" },
      { icon: "fas fa-coins", color: "#f59e0b", label: "Payments", value: "USDC & EURC (testnet)" },
      { icon: "fas fa-file-contract", color: "#8b5cf6", label: "Escrow", value: "ShuklyEscrow Smart Contract" },
      { icon: "fas fa-wallet", color: "#10b981", label: "Wallet", value: "Non-custodial \xB7 BIP39 \xB7 ethers.js" },
      { icon: "fas fa-server", color: "#ef4444", label: "Backend", value: "Hono.js \xB7 Cloudflare Workers" },
      { icon: "fas fa-shield-alt", color: "#ec4899", label: "Security", value: "CSP \xB7 HSTS \xB7 Permissions-Policy" }
    ].map((t) => `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:#f8fafc;border-radius:12px;border:1px solid #f1f5f9;">
              <div style="width:32px;height:32px;border-radius:8px;background:${t.color}1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="${t.icon}" style="color:${t.color};font-size:.8rem;"></i>
              </div>
              <div>
                <p style="font-size:.7rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin:0 0 2px;">${t.label}</p>
                <p style="font-size:.8rem;color:#334155;font-weight:500;margin:0;">${t.value}</p>
              </div>
            </div>
          `).join("")}
        </div>
      </section>

      <!-- Smart Contracts -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fas fa-file-code text-emerald-600"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Smart Contracts \u2014 Arc Testnet</h2>
        </div>
        <div class="space-y-2">
          ${[
      { label: "USDC (native)", addr: "${ARC.contracts.USDC}" },
      { label: "EURC (ERC-20)", addr: "${ARC.contracts.EURC}" },
      { label: "ShuklyEscrow", addr: "0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511" }
    ].map((c) => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #f1f5f9;flex-wrap:wrap;">
              <span style="font-size:.8rem;font-weight:600;color:#475569;min-width:100px;">${c.label}</span>
              <code style="font-size:.7rem;color:#64748b;font-family:monospace;word-break:break-all;">${c.addr}</code>
              <a href="https://testnet.arcscan.app/address/${c.addr}" target="_blank"
                 style="font-size:.7rem;color:#dc2626;text-decoration:none;white-space:nowrap;flex-shrink:0;">
                <i class="fas fa-external-link-alt"></i> ArcScan
              </a>
            </div>
          `).join("")}
        </div>
      </section>

      <!-- Open Source & Links -->
      <section class="card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i class="fab fa-github text-slate-700"></i>
          </div>
          <h2 class="text-lg font-bold text-slate-800 m-0">Open Source</h2>
        </div>
        <p class="text-slate-600 text-sm leading-relaxed mb-4">
          The complete source code of Shukly Store is publicly available for inspection, audit, and contribution.
          Transparency is a core principle of this project.
        </p>
        <div class="flex flex-wrap gap-3">
          <a href="https://github.com/julenosinger/redhawk-store" target="_blank" class="btn-primary text-sm">
            <i class="fab fa-github"></i> View on GitHub
          </a>
          <a href="https://testnet.arcscan.app" target="_blank" class="btn-secondary text-sm">
            <i class="fas fa-search"></i> Arc Explorer
          </a>
          <a href="https://faucet.circle.com" target="_blank" class="btn-secondary text-sm">
            <i class="fas fa-faucet"></i> Get Test USDC
          </a>
          <a href="/terms" class="btn-secondary text-sm">
            <i class="fas fa-file-alt"></i> Terms
          </a>
          <a href="/privacy" class="btn-secondary text-sm">
            <i class="fas fa-lock"></i> Privacy
          </a>
          <a href="/disclaimer" class="btn-secondary text-sm">
            <i class="fas fa-exclamation-triangle"></i> Disclaimer
          </a>
        </div>
      </section>

    </div><!-- /main grid -->
  </div>
  `,
    /* extraHead — JSON-LD + page-specific meta */
    `<!-- About page: override meta description and inject JSON-LD -->
  <meta name="description" content="Testnet-only platform built on Arc Network. No real funds, no financial risk. Designed for development and testing."/>
  <meta name="robots" content="index,follow"/>
  <meta name="keywords" content="testnet environment, no real assets, non-custodial, security-focused development, Arc Network, experimental platform, blockchain testing"/>
  <meta property="og:title" content="About Us | Shukly Store"/>
  <meta property="og:description" content="Testnet-only platform built on Arc Network. No real funds, no financial risk. Designed for development and testing."/>
  <meta property="og:url" content="https://shukly-store.pages.dev/about"/>
  <script type="application/ld+json">${jsonLd}</script>`
  );
}
function deployEscrowPage() {
  return shell("Deploy ShuklyEscrow", `
  <div class="max-w-2xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
      <i class="fas fa-code text-red-500"></i> ShuklyEscrow Contract
    </h1>
    <p class="text-slate-500 mb-6">The ShuklyEscrow contract is deployed and <strong>fully verified</strong> on Arc Testnet.</p>

    <!-- Verified Contract Banner -->
    <div class="card p-4 mb-6 bg-green-50 border border-green-200">
      <div class="flex items-start gap-3">
        <i class="fas fa-check-circle text-green-600 text-xl mt-0.5 shrink-0"></i>
        <div class="flex-1">
          <p class="font-semibold text-green-800 text-sm">Contract Source Code Verified \u2705</p>
          <p class="text-green-700 text-xs mt-1 font-mono break-all">0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511</p>
          <div class="flex flex-wrap gap-2 mt-2">
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511" target="_blank"
               class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 transition-colors">
              <i class="fas fa-external-link-alt mr-1"></i> View on ArcScan
            </a>
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511?tab=read_contract" target="_blank"
               class="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors">
              <i class="fas fa-book-open mr-1"></i> Read Contract
            </a>
            <a href="https://testnet.arcscan.app/address/0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511?tab=write_contract" target="_blank"
               class="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-700 transition-colors">
              <i class="fas fa-pen mr-1"></i> Write Contract
            </a>
            <a href="/api/escrow/abi" target="_blank"
               class="text-xs bg-slate-600 text-white px-3 py-1 rounded hover:bg-slate-700 transition-colors">
              <i class="fas fa-code mr-1"></i> ABI (JSON)
            </a>
          </div>
          <div class="mt-3 text-xs text-green-700 space-y-0.5">
            <p><strong>Compiler:</strong> solc v0.8.34+commit.80d5c536</p>
            <p><strong>Optimization:</strong> Enabled \u2014 200 runs</p>
            <p><strong>License:</strong> MIT</p>
            <p><strong>Not a proxy</strong> \u2014 direct implementation contract</p>
            <p><strong>No constructor arguments</strong></p>
          </div>
        </div>
      </div>
    </div>

    <div class="card p-6 mb-6">
      <h2 class="font-bold text-slate-800 mb-3 flex items-center gap-2"><i class="fas fa-info-circle text-blue-500"></i> Pre-requisites</h2>
      <ul class="space-y-2 text-sm text-slate-600">
        <li class="flex items-start gap-2"><i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i> MetaMask installed and connected to Arc Testnet (Chain ID: 5042002)</li>
        <li class="flex items-start gap-2"><i class="fas fa-check-circle text-green-500 mt-0.5 shrink-0"></i> Small amount of USDC for gas fees</li>
        <li class="flex items-start gap-2"><i class="fas fa-info-circle text-blue-500 mt-0.5 shrink-0"></i> <span>Get free testnet tokens at <a href="https://faucet.circle.com" target="_blank" class="text-red-600 underline">faucet.circle.com</a></span></li>
      </ul>
    </div>

    <div id="deploy-status" class="mb-4"></div>

    <div class="card p-6 mb-4">
      <h2 class="font-bold text-slate-800 mb-4"><i class="fas fa-rocket mr-2 text-red-500"></i> Deploy Contract</h2>
      <div id="current-escrow" class="mb-4 p-3 rounded-lg bg-slate-50 border text-sm text-slate-600">
        <strong>Current escrow address:</strong> <span id="current-escrow-addr" class="font-mono">loading\u2026</span>
      </div>
      <button id="deploy-btn" onclick="deployContract()" class="btn-primary w-full justify-center py-3 text-base font-bold">
        <i class="fas fa-rocket mr-2"></i> Deploy ShuklyEscrow via MetaMask
      </button>
      <div class="mt-4 border-t pt-4">
        <p class="text-xs text-slate-500 mb-2">Already have a deployed contract? Set the address manually:</p>
        <div class="flex gap-2">
          <input id="manual-addr-input" type="text" class="input text-xs flex-1" placeholder="0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511" value="0x26f290dAe5A54f68b3191C79d710e2A8C2E5A511"/>
          <button onclick="setManualAddr()" class="btn-secondary text-xs px-3 py-2 whitespace-nowrap">Set Address</button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-3 text-center">Deployer wallet becomes the contract owner. Gas paid in USDC on Arc Network.</p>
    </div>

    <div id="deployed-result" class="hidden card p-6 bg-emerald-50 border-emerald-200 mb-4">
      <h3 class="font-bold text-emerald-800 mb-2 flex items-center gap-2"><i class="fas fa-check-circle text-emerald-500"></i> Contract Deployed!</h3>
      <p class="text-sm text-emerald-700 mb-3">Address saved to browser. All checkouts will now use this contract.</p>
      <div class="bg-white border rounded-lg p-3 font-mono text-xs break-all" id="deployed-addr-display"></div>
      <a id="deployed-explorer-link" href="#" target="_blank" class="mt-3 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline">
        <i class="fas fa-external-link-alt"></i> View on Explorer
      </a>
    </div>

    <div class="card p-6 text-sm text-slate-500">
      <h3 class="font-semibold text-slate-700 mb-2">ShuklyEscrow Functions</h3>
      <ul class="space-y-1 font-mono text-xs">
        <li><span class="text-purple-600">createEscrow</span>(bytes32 orderId, address seller, address token, uint256 amount)</li>
        <li><span class="text-purple-600">fundEscrow</span>(bytes32 orderId) \u2014 pulls tokens from buyer</li>
        <li><span class="text-purple-600">confirmDelivery</span>(bytes32 orderId) \u2014 buyer confirms receipt</li>
        <li><span class="text-purple-600">releaseFunds</span>(bytes32 orderId) \u2014 releases to seller</li>
        <li><span class="text-purple-600">refund</span>(bytes32 orderId) \u2014 returns to buyer</li>
        <li><span class="text-purple-600">openDispute</span>(bytes32 orderId)</li>
        <li><span class="text-purple-600">getEscrow</span>(bytes32 orderId) view</li>
      </ul>
    </div>
  </div>

  <script>
  const ESCROW_BYTECODE = '0x60806040525f6002553480156012575f5ffd5b50600180546001600160a01b031916331790556111ad806100325f395ff3fe608060405234801561000f575f5ffd5b50600436106100a6575f3560e01c806374950ffd1161006e57806374950ffd146101695780638da5cb5b1461017c578063c92ee043146101a7578063f023b811146101ba578063f08ef6cb14610211578063f8e65d6114610224575f5ffd5b806324a9d853146100aa5780632d83549c146100c657806343a0e3e61461012e5780636e629653146101435780637249fbb614610156575b5f5ffd5b6100b360025481565b6040519081526020015b60405180910390f35b61011c6100d4366004610fb2565b5f602081905290815260409020805460018201546002830154600384015460048501546005909501546001600160a01b03948516959385169490921692909160ff9091169086565b6040516100bd96959493929190610fdd565b61014161013c366004611044565b610237565b005b61014161015136600461108d565b61049f565b610141610164366004610fb2565b61073f565b610141610177366004610fb2565b61090f565b60015461018f906001600160a01b031681565b6040516001600160a01b0390911681526020016100bd565b6101416101b5366004610fb2565b6109ef565b61011c6101c8366004610fb2565b5f908152602081905260409020805460018201546002830154600384015460048501546005909501546001600160a01b0394851696938516959490921693909260ff9091169190565b61014161021f366004610fb2565b610ca3565b610141610232366004610fb2565b610de1565b6001546001600160a01b031633146102835760405162461bcd60e51b815260206004820152600a60248201526927b7363c9037bbb732b960b11b60448201526064015b60405180910390fd5b5f8281526020819052604090206005600482015460ff1660058111156102ab576102ab610fc9565b146102e75760405162461bcd60e51b815260206004820152600c60248201526b139bdd08191a5cdc1d5d195960a21b604482015260640161027a565b81156103cf576004818101805460ff19166003908117909155600283015460018401549184015460405163a9059cbb60e01b81526001600160a01b03938416948101949094526024840152169063a9059cbb906044016020604051808303815f875af1158015610359573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061037d91906110ce565b50600181015460038201546040519081526001600160a01b039091169084907f75d86e5bfa1175e2dc677f3abe3aebba3069f2db6ae492f1734d4b4bc65f61c1906020015b60405180910390a3505050565b6004818101805460ff19168217905560028201548254600384015460405163a9059cbb60e01b81526001600160a01b03928316948101949094526024840152169063a9059cbb906044016020604051808303815f875af1158015610435573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061045991906110ce565b50805460038201546040519081526001600160a01b039091169084907ffc31a7ddbe933aa6e67f3c98c183fbc87addd2b602fcfb10238d2f85cf026617906020016103c2565b5f848152602081905260409020546001600160a01b0316156104fb5760405162461bcd60e51b8152602060048201526015602482015274457363726f7720616c72656164792065786973747360581b604482015260640161027a565b6001600160a01b0383166105425760405162461bcd60e51b815260206004820152600e60248201526d24b73b30b634b21039b2b63632b960911b604482015260640161027a565b336001600160a01b038416036105935760405162461bcd60e51b8152602060048201526016602482015275213abcb2b91031b0b73737ba1031329039b2b63632b960511b604482015260640161027a565b6001600160a01b0382166105d95760405162461bcd60e51b815260206004820152600d60248201526c24b73b30b634b2103a37b5b2b760991b604482015260640161027a565b5f811161061d5760405162461bcd60e51b81526020600482015260126024820152710416d6f756e74206d757374206265203e20360741b604482015260640161027a565b6040805160c0810182523381526001600160a01b03858116602083015284169181019190915260608101829052608081015f8152426020918201525f868152808252604090819020835181546001600160a01b03199081166001600160a01b039283161783559385015160018084018054871692841692909217909155928501516002830180549095169116179092556060830151600383015560808301516004830180549192909160ff1916908360058111156106dd576106dd610fc9565b021790555060a09190910151600590910155604080516001600160a01b03848116825260208201849052851691339187917fa659390cb932e6b1ea09aba8819db2052575206b54a121463b49371aa8dae6a7910160405180910390a450505050565b5f8181526020819052604090205481906001600160a01b031633146107765760405162461bcd60e51b815260040161027a906110f0565b5f8281526020819052604090206001600482015460ff16600581111561079e5761079e610fc9565b146107eb5760405162461bcd60e51b815260206004820152601e60248201527f43616e6e6f7420726566756e6420696e2063757272656e742073746174650000604482015260640161027a565b6004818101805460ff19168217905560028201548254600384015460405163a9059cbb60e01b81526001600160a01b039283169481019490945260248401525f9291169063a9059cbb906044016020604051808303815f875af1158015610854573d5f5f3e3d5ffd5b505050506040513d601f19601f8201168201806040525081019061087891906110ce565b9050806108c05760405162461bcd60e51b81526020600482015260166024820152751499599d5b99081d1c985b9cd9995c8819985a5b195960521b604482015260640161027a565b815460038301546040519081526001600160a01b039091169085907ffc31a7ddbe933aa6e67f3c98c183fbc87addd2b602fcfb10238d2f85cf026617906020015b60405180910390a350505050565b5f8181526020819052604090205481906001600160a01b031633146109465760405162461bcd60e51b815260040161027a906110f0565b5f8281526020819052604090206001600482015460ff16600581111561096e5761096e610fc9565b146109af5760405162461bcd60e51b8152602060048201526011602482015270115cd8dc9bddc81b9bdd08119553911151607a1b604482015260640161027a565b60048101805460ff19166002179055604051339084907ff46bccfdb06ecc81738bcfc5ee961cc50fe62e4a5060c050d8bf69bcd1d47731905f90a3505050565b5f81815260208190526040902080546001600160a01b0316331480610a20575060018101546001600160a01b031633145b610a635760405162461bcd60e51b815260206004820152601460248201527327b7363c90313abcb2b91037b91039b2b63632b960611b604482015260640161027a565b6002600482015460ff166005811115610a7e57610a7e610fc9565b14610ac25760405162461bcd60e51b8152602060048201526014602482015273115cd8dc9bddc81b9bdd0810d3d391925493515160621b604482015260640161027a565b60048101805460ff19166003908117909155600254908201545f9161271091610aeb9190611128565b610af59190611145565b90505f818360030154610b089190611164565b6002840154600185015460405163a9059cbb60e01b81526001600160a01b039182166004820152602481018490529293505f9291169063a9059cbb906044016020604051808303815f875af1158015610b63573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610b8791906110ce565b905080610bd65760405162461bcd60e51b815260206004820152601960248201527f5472616e7366657220746f2073656c6c6572206661696c656400000000000000604482015260640161027a565b8215610c5657600284015460015460405163a9059cbb60e01b81526001600160a01b0391821660048201526024810186905291169063a9059cbb906044016020604051808303815f875af1158015610c30573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610c5491906110ce565b505b60018401546040518381526001600160a01b039091169086907f75d86e5bfa1175e2dc677f3abe3aebba3069f2db6ae492f1734d4b4bc65f61c19060200160405180910390a35050505050565b5f81815260208190526040902080546001600160a01b0316331480610cd4575060018101546001600160a01b031633145b610d175760405162461bcd60e51b815260206004820152601460248201527327b7363c90313abcb2b91037b91039b2b63632b960611b604482015260640161027a565b6001600482015460ff166005811115610d3257610d32610fc9565b1480610d5657506002600482015460ff166005811115610d5457610d54610fc9565b145b610da25760405162461bcd60e51b815260206004820152601f60248201527f43616e6e6f74206469737075746520696e2063757272656e7420737461746500604482015260640161027a565b60048101805460ff19166005179055604051339083907fe7b614d99462ab012c8191c9348164cd62a4aec6d211f42371fd1f0759e5c220905f90a35050565b5f8181526020819052604090205481906001600160a01b03163314610e185760405162461bcd60e51b815260040161027a906110f0565b5f82815260208190526040812090600482015460ff166005811115610e3f57610e3f610fc9565b14610e8c5760405162461bcd60e51b815260206004820152601960248201527f457363726f77206e6f7420696e20454d50545920737461746500000000000000604482015260640161027a565b600281015460038201546040516323b872dd60e01b815233600482015230602482015260448101919091525f916001600160a01b0316906323b872dd906064016020604051808303815f875af1158015610ee8573d5f5f3e3d5ffd5b505050506040513d601f19601f82011682018060405250810190610f0c91906110ce565b905080610f6a5760405162461bcd60e51b815260206004820152602660248201527f546f6b656e207472616e73666572206661696c65643a20636865636b20616c6c6044820152656f77616e636560d01b606482015260840161027a565b60048201805460ff191660011790556003820154604051908152339085907fb0f7b6ab70e0186c433938ee752b2498a7cab42018e6bf7596cd704c81c470bc90602001610901565b5f60208284031215610fc2575f5ffd5b5035919050565b634e487b7160e01b5f52602160045260245ffd5b6001600160a01b0387811682528681166020830152851660408201526060810184905260c081016006841061102057634e487b7160e01b5f52602160045260245ffd5b608082019390935260a00152949350505050565b8015158114611041575f5ffd5b50565b5f5f60408385031215611055575f5ffd5b82359150602083013561106781611034565b809150509250929050565b80356001600160a01b0381168114611088575f5ffd5b919050565b5f5f5f5f608085870312156110a0575f5ffd5b843593506110b060208601611072565b92506110be60408601611072565b9396929550929360600135925050565b5f602082840312156110de575f5ffd5b81516110e981611034565b9392505050565b6020808252600a908201526927b7363c90313abcb2b960b11b604082015260600190565b634e487b7160e01b5f52601160045260245ffd5b808202811582820484141761113f5761113f611114565b92915050565b5f8261115f57634e487b7160e01b5f52601260045260245ffd5b500490565b8181038181111561113f5761113f61111456fea2646970667358221220005a0901a06072c1c8d0bb8592692ff2bdda55f3fd069fcfda67dd532120acd064736f6c63430008220033';

  document.addEventListener('DOMContentLoaded', () => {
    const addr = localStorage.getItem('shukly_escrow_address') || window.ARC.contracts.ShuklyEscrow || 'Not set';
    document.getElementById('current-escrow-addr').textContent = addr;
    if(addr && addr.startsWith('0x') && addr !== '0x0000000000000000000000000000000000000000') {
      document.getElementById('deployed-addr-display').textContent = addr;
      document.getElementById('deployed-explorer-link').href = window.ARC.explorer + '/address/' + addr;
      document.getElementById('deployed-result').classList.remove('hidden');
    }
  });

  function setManualAddr() {
    const input = document.getElementById('manual-addr-input');
    const addr = (input.value || '').trim();
    if (!addr || !addr.startsWith('0x') || addr.length !== 42) {
      alert('Invalid address \u2014 must be a 42-char hex address starting with 0x');
      return;
    }
    localStorage.setItem('shukly_escrow_address', addr);
    document.getElementById('current-escrow-addr').textContent = addr;
    document.getElementById('deployed-addr-display').textContent = addr;
    document.getElementById('deployed-explorer-link').href = window.ARC.explorer + '/address/' + addr;
    document.getElementById('deployed-result').classList.remove('hidden');
    document.getElementById('deploy-status').innerHTML = '<div class="p-4 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 text-sm"><i class="fas fa-check-circle mr-2"></i>Escrow address set to ' + addr + '. All checkouts will now use this contract.</div>';
  }

  async function deployContract() {
    const statusEl = document.getElementById('deploy-status');
    const btn = document.getElementById('deploy-btn');
    const resultEl = document.getElementById('deployed-result');

    const setStatus = (msg, type='info') => {
      const colors = { info:'bg-blue-50 border-blue-200 text-blue-800', success:'bg-emerald-50 border-emerald-200 text-emerald-800', error:'bg-red-50 border-red-200 text-red-800', warning:'bg-amber-50 border-amber-200 text-amber-800' };
      statusEl.innerHTML = '<div class="p-4 rounded-lg border '+colors[type]+' text-sm">'+msg+'</div>';
    };

    try {
      if(!window.ethereum) { setStatus('<i class="fas fa-exclamation-circle mr-2"></i>MetaMask not detected. Please install MetaMask.', 'error'); return; }
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Connecting MetaMask\u2026';

      const provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);

      // Ensure Arc Testnet
      const net = await provider.getNetwork();
      if(net.chainId !== BigInt(window.ARC.chainId)) {
        setStatus('<i class="fas fa-exclamation-triangle mr-2"></i>Please switch MetaMask to Arc Testnet (Chain ID: 5042002) and try again.', 'warning');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket mr-2"></i> Deploy ShuklyEscrow via MetaMask';
        return;
      }

      const signer = await provider.getSigner();
      const deployerAddr = await signer.getAddress();
      setStatus('<i class="fas fa-spinner fa-spin mr-2"></i>Deploying from <code class="font-mono text-xs">'+deployerAddr.slice(0,14)+'\u2026</code> \u2014 confirm in MetaMask\u2026', 'info');
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Confirm in MetaMask\u2026';

      // Deploy using ContractFactory with full ABI
      const factory = new ethers.ContractFactory(ESCROW_ABI, ESCROW_BYTECODE, signer);
      const contract = await factory.deploy();

      setStatus('<i class="fas fa-spinner fa-spin mr-2"></i>Waiting for on-chain confirmation\u2026 <code class="font-mono text-xs">'+contract.deploymentTransaction().hash.slice(0,14)+'\u2026</code>', 'info');
      btn.innerHTML = '<span class="loading-spinner inline-block mr-2"></span>Waiting for confirmation\u2026';

      await contract.waitForDeployment();
      const deployedAddress = await contract.getAddress();
      const txHash = contract.deploymentTransaction().hash;

      // Save to localStorage
      localStorage.setItem('shukly_escrow_address', deployedAddress);
      document.getElementById('current-escrow-addr').textContent = deployedAddress;

      // Show result
      document.getElementById('deployed-addr-display').textContent = deployedAddress;
      const explorerUrl = window.ARC.explorer + '/address/' + deployedAddress;
      document.getElementById('deployed-explorer-link').href = explorerUrl;
      resultEl.classList.remove('hidden');

      setStatus('<i class="fas fa-check-circle mr-2"></i>Deployed at <code class="font-mono text-xs">'+deployedAddress+'</code>. Tx: <a href="'+window.ARC.explorer+'/tx/'+txHash+'" target="_blank" class="underline font-mono text-xs">'+txHash.slice(0,18)+'\u2026</a>', 'success');
      btn.innerHTML = '<i class="fas fa-check mr-2"></i> Deployed Successfully';

    } catch(err) {
      const msg = err.code==='ACTION_REJECTED'||err.code===4001
        ? 'Deployment rejected by user.'
        : 'Deploy error: '+(err.shortMessage||err.message||'Unknown error');
      setStatus('<i class="fas fa-times-circle mr-2"></i>'+msg, 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-rocket mr-2"></i> Retry Deployment';
    }
  }
  </script>
  `);
}

// api/_entry.tsx
var wrapped = new Hono2();
wrapped.use("*", async (c, next) => {
  c.env = {
    CIRCLE_API_KEY: process.env.CIRCLE_API_KEY ?? ""
  };
  return next();
});
wrapped.route("/", src_default);
var handler = handle(wrapped);
var entry_default = handler;
export {
  entry_default as default
};
