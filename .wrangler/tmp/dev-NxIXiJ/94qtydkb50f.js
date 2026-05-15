var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-HkeM7j/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-HkeM7j/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// .wrangler/tmp/pages-VZJxGp/bundledWorker-0.5875258660714584.mjs
var __defProp2 = Object.defineProperty;
var __name2 = /* @__PURE__ */ __name((target, value) => __defProp2(target, "name", { value, configurable: true }), "__name");
var urls2 = /* @__PURE__ */ new Set();
function checkURL2(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls2.has(url.toString())) {
      urls2.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL2, "checkURL");
__name2(checkURL2, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL2(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});
function stripCfConnectingIPHeader2(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader2, "stripCfConnectingIPHeader");
__name2(stripCfConnectingIPHeader2, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader2.apply(null, argArray)
    ]);
  }
});
var kt = Object.defineProperty;
var Ve = /* @__PURE__ */ __name2((t) => {
  throw TypeError(t);
}, "Ve");
var St = /* @__PURE__ */ __name2((t, e, s) => e in t ? kt(t, e, { enumerable: true, configurable: true, writable: true, value: s }) : t[e] = s, "St");
var u = /* @__PURE__ */ __name2((t, e, s) => St(t, typeof e != "symbol" ? e + "" : e, s), "u");
var Oe = /* @__PURE__ */ __name2((t, e, s) => e.has(t) || Ve("Cannot " + s), "Oe");
var r = /* @__PURE__ */ __name2((t, e, s) => (Oe(t, e, "read from private field"), s ? s.call(t) : e.get(t)), "r");
var h = /* @__PURE__ */ __name2((t, e, s) => e.has(t) ? Ve("Cannot add the same private member more than once") : e instanceof WeakSet ? e.add(t) : e.set(t, s), "h");
var g = /* @__PURE__ */ __name2((t, e, s, a) => (Oe(t, e, "write to private field"), a ? a.call(t, s) : e.set(t, s), s), "g");
var x = /* @__PURE__ */ __name2((t, e, s) => (Oe(t, e, "access private method"), s), "x");
var Ge = /* @__PURE__ */ __name2((t, e, s, a) => ({ set _(o) {
  g(t, e, o, s);
}, get _() {
  return r(t, e, a);
} }), "Ge");
var Ke = /* @__PURE__ */ __name2((t, e, s) => (a, o) => {
  let i = -1;
  return n(0);
  async function n(d) {
    if (d <= i)
      throw new Error("next() called multiple times");
    i = d;
    let l, c = false, p;
    if (t[d] ? (p = t[d][0][0], a.req.routeIndex = d) : p = d === t.length && o || void 0, p)
      try {
        l = await p(a, () => n(d + 1));
      } catch (f) {
        if (f instanceof Error && e)
          a.error = f, l = await e(f, a), c = true;
        else
          throw f;
      }
    else
      a.finalized === false && s && (l = await s(a));
    return l && (a.finalized === false || c) && (a.res = l), a;
  }
  __name(n, "n");
  __name2(n, "n");
}, "Ke");
var At = Symbol();
var zt = /* @__PURE__ */ __name2(async (t, e = /* @__PURE__ */ Object.create(null)) => {
  const { all: s = false, dot: a = false } = e, i = (t instanceof dt ? t.raw.headers : t.headers).get("Content-Type");
  return i != null && i.startsWith("multipart/form-data") || i != null && i.startsWith("application/x-www-form-urlencoded") ? Et(t, { all: s, dot: a }) : {};
}, "zt");
async function Et(t, e) {
  const s = await t.formData();
  return s ? Ct(s, e) : {};
}
__name(Et, "Et");
__name2(Et, "Et");
function Ct(t, e) {
  const s = /* @__PURE__ */ Object.create(null);
  return t.forEach((a, o) => {
    e.all || o.endsWith("[]") ? Rt(s, o, a) : s[o] = a;
  }), e.dot && Object.entries(s).forEach(([a, o]) => {
    a.includes(".") && (Mt(s, a, o), delete s[a]);
  }), s;
}
__name(Ct, "Ct");
__name2(Ct, "Ct");
var Rt = /* @__PURE__ */ __name2((t, e, s) => {
  t[e] !== void 0 ? Array.isArray(t[e]) ? t[e].push(s) : t[e] = [t[e], s] : e.endsWith("[]") ? t[e] = [s] : t[e] = s;
}, "Rt");
var Mt = /* @__PURE__ */ __name2((t, e, s) => {
  if (/(?:^|\.)__proto__\./.test(e))
    return;
  let a = t;
  const o = e.split(".");
  o.forEach((i, n) => {
    n === o.length - 1 ? a[i] = s : ((!a[i] || typeof a[i] != "object" || Array.isArray(a[i]) || a[i] instanceof File) && (a[i] = /* @__PURE__ */ Object.create(null)), a = a[i]);
  });
}, "Mt");
var ot = /* @__PURE__ */ __name2((t) => {
  const e = t.split("/");
  return e[0] === "" && e.shift(), e;
}, "ot");
var Dt = /* @__PURE__ */ __name2((t) => {
  const { groups: e, path: s } = It(t), a = ot(s);
  return Lt(a, e);
}, "Dt");
var It = /* @__PURE__ */ __name2((t) => {
  const e = [];
  return t = t.replace(/\{[^}]+\}/g, (s, a) => {
    const o = `@${a}`;
    return e.push([o, s]), o;
  }), { groups: e, path: t };
}, "It");
var Lt = /* @__PURE__ */ __name2((t, e) => {
  for (let s = e.length - 1; s >= 0; s--) {
    const [a] = e[s];
    for (let o = t.length - 1; o >= 0; o--)
      if (t[o].includes(a)) {
        t[o] = t[o].replace(a, e[s][1]);
        break;
      }
  }
  return t;
}, "Lt");
var De = {};
var Tt = /* @__PURE__ */ __name2((t, e) => {
  if (t === "*")
    return "*";
  const s = t.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (s) {
    const a = `${t}#${e}`;
    return De[a] || (s[2] ? De[a] = e && e[0] !== ":" && e[0] !== "*" ? [a, s[1], new RegExp(`^${s[2]}(?=/${e})`)] : [t, s[1], new RegExp(`^${s[2]}$`)] : De[a] = [t, s[1], true]), De[a];
  }
  return null;
}, "Tt");
var Ue = /* @__PURE__ */ __name2((t, e) => {
  try {
    return e(t);
  } catch {
    return t.replace(/(?:%[0-9A-Fa-f]{2})+/g, (s) => {
      try {
        return e(s);
      } catch {
        return s;
      }
    });
  }
}, "Ue");
var $t = /* @__PURE__ */ __name2((t) => Ue(t, decodeURI), "$t");
var it = /* @__PURE__ */ __name2((t) => {
  const e = t.url, s = e.indexOf("/", e.indexOf(":") + 4);
  let a = s;
  for (; a < e.length; a++) {
    const o = e.charCodeAt(a);
    if (o === 37) {
      const i = e.indexOf("?", a), n = e.indexOf("#", a), d = i === -1 ? n === -1 ? void 0 : n : n === -1 ? i : Math.min(i, n), l = e.slice(s, d);
      return $t(l.includes("%25") ? l.replace(/%25/g, "%2525") : l);
    } else if (o === 63 || o === 35)
      break;
  }
  return e.slice(s, a);
}, "it");
var jt = /* @__PURE__ */ __name2((t) => {
  const e = it(t);
  return e.length > 1 && e.at(-1) === "/" ? e.slice(0, -1) : e;
}, "jt");
var re = /* @__PURE__ */ __name2((t, e, ...s) => (s.length && (e = re(e, ...s)), `${(t == null ? void 0 : t[0]) === "/" ? "" : "/"}${t}${e === "/" ? "" : `${(t == null ? void 0 : t.at(-1)) === "/" ? "" : "/"}${(e == null ? void 0 : e[0]) === "/" ? e.slice(1) : e}`}`), "re");
var rt = /* @__PURE__ */ __name2((t) => {
  if (t.charCodeAt(t.length - 1) !== 63 || !t.includes(":"))
    return null;
  const e = t.split("/"), s = [];
  let a = "";
  return e.forEach((o) => {
    if (o !== "" && !/\:/.test(o))
      a += "/" + o;
    else if (/\:/.test(o))
      if (/\?/.test(o)) {
        s.length === 0 && a === "" ? s.push("/") : s.push(a);
        const i = o.replace("?", "");
        a += "/" + i, s.push(a);
      } else
        a += "/" + o;
  }), s.filter((o, i, n) => n.indexOf(o) === i);
}, "rt");
var Fe = /* @__PURE__ */ __name2((t) => /[%+]/.test(t) ? (t.indexOf("+") !== -1 && (t = t.replace(/\+/g, " ")), t.indexOf("%") !== -1 ? Ue(t, lt) : t) : t, "Fe");
var nt = /* @__PURE__ */ __name2((t, e, s) => {
  let a;
  if (!s && e && !/[%+]/.test(e)) {
    let n = t.indexOf("?", 8);
    if (n === -1)
      return;
    for (t.startsWith(e, n + 1) || (n = t.indexOf(`&${e}`, n + 1)); n !== -1; ) {
      const d = t.charCodeAt(n + e.length + 1);
      if (d === 61) {
        const l = n + e.length + 2, c = t.indexOf("&", l);
        return Fe(t.slice(l, c === -1 ? void 0 : c));
      } else if (d == 38 || isNaN(d))
        return "";
      n = t.indexOf(`&${e}`, n + 1);
    }
    if (a = /[%+]/.test(t), !a)
      return;
  }
  const o = {};
  a ?? (a = /[%+]/.test(t));
  let i = t.indexOf("?", 8);
  for (; i !== -1; ) {
    const n = t.indexOf("&", i + 1);
    let d = t.indexOf("=", i);
    d > n && n !== -1 && (d = -1);
    let l = t.slice(i + 1, d === -1 ? n === -1 ? void 0 : n : d);
    if (a && (l = Fe(l)), i = n, l === "")
      continue;
    let c;
    d === -1 ? c = "" : (c = t.slice(d + 1, n === -1 ? void 0 : n), a && (c = Fe(c))), s ? (o[l] && Array.isArray(o[l]) || (o[l] = []), o[l].push(c)) : o[l] ?? (o[l] = c);
  }
  return e ? o[e] : o;
}, "nt");
var _t = nt;
var Bt = /* @__PURE__ */ __name2((t, e) => nt(t, e, true), "Bt");
var lt = decodeURIComponent;
var Ye = /* @__PURE__ */ __name2((t) => Ue(t, lt), "Ye");
var ce;
var C;
var F;
var ct;
var pt;
var He;
var H;
var Qe;
var dt = (Qe = /* @__PURE__ */ __name2(class {
  constructor(t, e = "/", s = [[]]) {
    h(this, F);
    u(this, "raw");
    h(this, ce);
    h(this, C);
    u(this, "routeIndex", 0);
    u(this, "path");
    u(this, "bodyCache", {});
    h(this, H, (t2) => {
      const { bodyCache: e2, raw: s2 } = this, a = e2[t2];
      if (a)
        return a;
      const o = Object.keys(e2)[0];
      return o ? e2[o].then((i) => (o === "json" && (i = JSON.stringify(i)), new Response(i)[t2]())) : e2[t2] = s2[t2]();
    });
    this.raw = t, this.path = e, g(this, C, s), g(this, ce, {});
  }
  param(t) {
    return t ? x(this, F, ct).call(this, t) : x(this, F, pt).call(this);
  }
  query(t) {
    return _t(this.url, t);
  }
  queries(t) {
    return Bt(this.url, t);
  }
  header(t) {
    if (t)
      return this.raw.headers.get(t) ?? void 0;
    const e = {};
    return this.raw.headers.forEach((s, a) => {
      e[a] = s;
    }), e;
  }
  async parseBody(t) {
    return zt(this, t);
  }
  json() {
    return r(this, H).call(this, "text").then((t) => JSON.parse(t));
  }
  text() {
    return r(this, H).call(this, "text");
  }
  arrayBuffer() {
    return r(this, H).call(this, "arrayBuffer");
  }
  blob() {
    return r(this, H).call(this, "blob");
  }
  formData() {
    return r(this, H).call(this, "formData");
  }
  addValidatedData(t, e) {
    r(this, ce)[t] = e;
  }
  valid(t) {
    return r(this, ce)[t];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [At]() {
    return r(this, C);
  }
  get matchedRoutes() {
    return r(this, C)[0].map(([[, t]]) => t);
  }
  get routePath() {
    return r(this, C)[0].map(([[, t]]) => t)[this.routeIndex].path;
  }
}, "Qe"), ce = /* @__PURE__ */ new WeakMap(), C = /* @__PURE__ */ new WeakMap(), F = /* @__PURE__ */ new WeakSet(), ct = /* @__PURE__ */ __name2(function(t) {
  const e = r(this, C)[0][this.routeIndex][1][t], s = x(this, F, He).call(this, e);
  return s && /\%/.test(s) ? Ye(s) : s;
}, "ct"), pt = /* @__PURE__ */ __name2(function() {
  const t = {}, e = Object.keys(r(this, C)[0][this.routeIndex][1]);
  for (const s of e) {
    const a = x(this, F, He).call(this, r(this, C)[0][this.routeIndex][1][s]);
    a !== void 0 && (t[s] = /\%/.test(a) ? Ye(a) : a);
  }
  return t;
}, "pt"), He = /* @__PURE__ */ __name2(function(t) {
  return r(this, C)[1] ? r(this, C)[1][t] : t;
}, "He"), H = /* @__PURE__ */ new WeakMap(), Qe);
var Pt = { Stringify: 1 };
var ft = /* @__PURE__ */ __name2(async (t, e, s, a, o) => {
  typeof t == "object" && !(t instanceof String) && (t instanceof Promise || (t = t.toString()), t instanceof Promise && (t = await t));
  const i = t.callbacks;
  return i != null && i.length ? (o ? o[0] += t : o = [t], Promise.all(i.map((d) => d({ phase: e, buffer: o, context: a }))).then((d) => Promise.all(d.filter(Boolean).map((l) => ft(l, e, false, a, o))).then(() => o[0]))) : Promise.resolve(t);
}, "ft");
var Ot = "text/plain; charset=UTF-8";
var Ne = /* @__PURE__ */ __name2((t, e) => ({ "Content-Type": t, ...e }), "Ne");
var ve = /* @__PURE__ */ __name2((t, e) => new Response(t, e), "ve");
var Ae;
var ze;
var _;
var pe;
var B;
var z;
var Ee;
var fe;
var ge;
var X;
var Ce;
var Re;
var U;
var ne;
var Ze;
var Ft = (Ze = /* @__PURE__ */ __name2(class {
  constructor(t, e) {
    h(this, U);
    h(this, Ae);
    h(this, ze);
    u(this, "env", {});
    h(this, _);
    u(this, "finalized", false);
    u(this, "error");
    h(this, pe);
    h(this, B);
    h(this, z);
    h(this, Ee);
    h(this, fe);
    h(this, ge);
    h(this, X);
    h(this, Ce);
    h(this, Re);
    u(this, "render", (...t2) => (r(this, fe) ?? g(this, fe, (e2) => this.html(e2)), r(this, fe).call(this, ...t2)));
    u(this, "setLayout", (t2) => g(this, Ee, t2));
    u(this, "getLayout", () => r(this, Ee));
    u(this, "setRenderer", (t2) => {
      g(this, fe, t2);
    });
    u(this, "header", (t2, e2, s) => {
      this.finalized && g(this, z, ve(r(this, z).body, r(this, z)));
      const a = r(this, z) ? r(this, z).headers : r(this, X) ?? g(this, X, new Headers());
      e2 === void 0 ? a.delete(t2) : s != null && s.append ? a.append(t2, e2) : a.set(t2, e2);
    });
    u(this, "status", (t2) => {
      g(this, pe, t2);
    });
    u(this, "set", (t2, e2) => {
      r(this, _) ?? g(this, _, /* @__PURE__ */ new Map()), r(this, _).set(t2, e2);
    });
    u(this, "get", (t2) => r(this, _) ? r(this, _).get(t2) : void 0);
    u(this, "newResponse", (...t2) => x(this, U, ne).call(this, ...t2));
    u(this, "body", (t2, e2, s) => x(this, U, ne).call(this, t2, e2, s));
    u(this, "text", (t2, e2, s) => !r(this, X) && !r(this, pe) && !e2 && !s && !this.finalized ? new Response(t2) : x(this, U, ne).call(this, t2, e2, Ne(Ot, s)));
    u(this, "json", (t2, e2, s) => x(this, U, ne).call(this, JSON.stringify(t2), e2, Ne("application/json", s)));
    u(this, "html", (t2, e2, s) => {
      const a = /* @__PURE__ */ __name2((o) => x(this, U, ne).call(this, o, e2, Ne("text/html; charset=UTF-8", s)), "a");
      return typeof t2 == "object" ? ft(t2, Pt.Stringify, false, {}).then(a) : a(t2);
    });
    u(this, "redirect", (t2, e2) => {
      const s = String(t2);
      return this.header("Location", /[^\x00-\xFF]/.test(s) ? encodeURI(s) : s), this.newResponse(null, e2 ?? 302);
    });
    u(this, "notFound", () => (r(this, ge) ?? g(this, ge, () => ve()), r(this, ge).call(this, this)));
    g(this, Ae, t), e && (g(this, B, e.executionCtx), this.env = e.env, g(this, ge, e.notFoundHandler), g(this, Re, e.path), g(this, Ce, e.matchResult));
  }
  get req() {
    return r(this, ze) ?? g(this, ze, new dt(r(this, Ae), r(this, Re), r(this, Ce))), r(this, ze);
  }
  get event() {
    if (r(this, B) && "respondWith" in r(this, B))
      return r(this, B);
    throw Error("This context has no FetchEvent");
  }
  get executionCtx() {
    if (r(this, B))
      return r(this, B);
    throw Error("This context has no ExecutionContext");
  }
  get res() {
    return r(this, z) || g(this, z, ve(null, { headers: r(this, X) ?? g(this, X, new Headers()) }));
  }
  set res(t) {
    if (r(this, z) && t) {
      t = ve(t.body, t);
      for (const [e, s] of r(this, z).headers.entries())
        if (e !== "content-type")
          if (e === "set-cookie") {
            const a = r(this, z).headers.getSetCookie();
            t.headers.delete("set-cookie");
            for (const o of a)
              t.headers.append("set-cookie", o);
          } else
            t.headers.set(e, s);
    }
    g(this, z, t), this.finalized = true;
  }
  get var() {
    return r(this, _) ? Object.fromEntries(r(this, _)) : {};
  }
}, "Ze"), Ae = /* @__PURE__ */ new WeakMap(), ze = /* @__PURE__ */ new WeakMap(), _ = /* @__PURE__ */ new WeakMap(), pe = /* @__PURE__ */ new WeakMap(), B = /* @__PURE__ */ new WeakMap(), z = /* @__PURE__ */ new WeakMap(), Ee = /* @__PURE__ */ new WeakMap(), fe = /* @__PURE__ */ new WeakMap(), ge = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakMap(), Ce = /* @__PURE__ */ new WeakMap(), Re = /* @__PURE__ */ new WeakMap(), U = /* @__PURE__ */ new WeakSet(), ne = /* @__PURE__ */ __name2(function(t, e, s) {
  const a = r(this, z) ? new Headers(r(this, z).headers) : r(this, X) ?? new Headers();
  if (typeof e == "object" && "headers" in e) {
    const i = e.headers instanceof Headers ? e.headers : new Headers(e.headers);
    for (const [n, d] of i)
      n.toLowerCase() === "set-cookie" ? a.append(n, d) : a.set(n, d);
  }
  if (s)
    for (const [i, n] of Object.entries(s))
      if (typeof n == "string")
        a.set(i, n);
      else {
        a.delete(i);
        for (const d of n)
          a.append(i, d);
      }
  const o = typeof e == "number" ? e : (e == null ? void 0 : e.status) ?? r(this, pe);
  return ve(t, { status: o, headers: a });
}, "ne"), Ze);
var v = "ALL";
var Nt = "all";
var Ht = ["get", "post", "put", "delete", "options", "patch"];
var gt = "Can not add a route since the matcher is already built.";
var ut = /* @__PURE__ */ __name2(class extends Error {
}, "ut");
var Ut = "__COMPOSED_HANDLER";
var Wt = /* @__PURE__ */ __name2((t) => t.text("404 Not Found", 404), "Wt");
var Je = /* @__PURE__ */ __name2((t, e) => {
  if ("getResponse" in t) {
    const s = t.getResponse();
    return e.newResponse(s.body, s);
  }
  return console.error(t), e.text("Internal Server Error", 500);
}, "Je");
var M;
var w;
var bt;
var D;
var Y;
var Ie;
var Le;
var ue;
var qt = (ue = /* @__PURE__ */ __name2(class {
  constructor(e = {}) {
    h(this, w);
    u(this, "get");
    u(this, "post");
    u(this, "put");
    u(this, "delete");
    u(this, "options");
    u(this, "patch");
    u(this, "all");
    u(this, "on");
    u(this, "use");
    u(this, "router");
    u(this, "getPath");
    u(this, "_basePath", "/");
    h(this, M, "/");
    u(this, "routes", []);
    h(this, D, Wt);
    u(this, "errorHandler", Je);
    u(this, "onError", (e2) => (this.errorHandler = e2, this));
    u(this, "notFound", (e2) => (g(this, D, e2), this));
    u(this, "fetch", (e2, ...s) => x(this, w, Le).call(this, e2, s[1], s[0], e2.method));
    u(this, "request", (e2, s, a2, o2) => e2 instanceof Request ? this.fetch(s ? new Request(e2, s) : e2, a2, o2) : (e2 = e2.toString(), this.fetch(new Request(/^https?:\/\//.test(e2) ? e2 : `http://localhost${re("/", e2)}`, s), a2, o2)));
    u(this, "fire", () => {
      addEventListener("fetch", (e2) => {
        e2.respondWith(x(this, w, Le).call(this, e2.request, e2, void 0, e2.request.method));
      });
    });
    [...Ht, Nt].forEach((i) => {
      this[i] = (n, ...d) => (typeof n == "string" ? g(this, M, n) : x(this, w, Y).call(this, i, r(this, M), n), d.forEach((l) => {
        x(this, w, Y).call(this, i, r(this, M), l);
      }), this);
    }), this.on = (i, n, ...d) => {
      for (const l of [n].flat()) {
        g(this, M, l);
        for (const c of [i].flat())
          d.map((p) => {
            x(this, w, Y).call(this, c.toUpperCase(), r(this, M), p);
          });
      }
      return this;
    }, this.use = (i, ...n) => (typeof i == "string" ? g(this, M, i) : (g(this, M, "*"), n.unshift(i)), n.forEach((d) => {
      x(this, w, Y).call(this, v, r(this, M), d);
    }), this);
    const { strict: a, ...o } = e;
    Object.assign(this, o), this.getPath = a ?? true ? e.getPath ?? it : jt;
  }
  route(e, s) {
    const a = this.basePath(e);
    return s.routes.map((o) => {
      var n;
      let i;
      s.errorHandler === Je ? i = o.handler : (i = /* @__PURE__ */ __name2(async (d, l) => (await Ke([], s.errorHandler)(d, () => o.handler(d, l))).res, "i"), i[Ut] = o.handler), x(n = a, w, Y).call(n, o.method, o.path, i);
    }), this;
  }
  basePath(e) {
    const s = x(this, w, bt).call(this);
    return s._basePath = re(this._basePath, e), s;
  }
  mount(e, s, a) {
    let o, i;
    a && (typeof a == "function" ? i = a : (i = a.optionHandler, a.replaceRequest === false ? o = /* @__PURE__ */ __name2((l) => l, "o") : o = a.replaceRequest));
    const n = i ? (l) => {
      const c = i(l);
      return Array.isArray(c) ? c : [c];
    } : (l) => {
      let c;
      try {
        c = l.executionCtx;
      } catch {
      }
      return [l.env, c];
    };
    o || (o = (() => {
      const l = re(this._basePath, e), c = l === "/" ? 0 : l.length;
      return (p) => {
        const f = new URL(p.url);
        return f.pathname = f.pathname.slice(c) || "/", new Request(f, p);
      };
    })());
    const d = /* @__PURE__ */ __name2(async (l, c) => {
      const p = await s(o(l.req.raw), ...n(l));
      if (p)
        return p;
      await c();
    }, "d");
    return x(this, w, Y).call(this, v, re(e, "*"), d), this;
  }
}, "ue"), M = /* @__PURE__ */ new WeakMap(), w = /* @__PURE__ */ new WeakSet(), bt = /* @__PURE__ */ __name2(function() {
  const e = new ue({ router: this.router, getPath: this.getPath });
  return e.errorHandler = this.errorHandler, g(e, D, r(this, D)), e.routes = this.routes, e;
}, "bt"), D = /* @__PURE__ */ new WeakMap(), Y = /* @__PURE__ */ __name2(function(e, s, a) {
  e = e.toUpperCase(), s = re(this._basePath, s);
  const o = { basePath: this._basePath, path: s, method: e, handler: a };
  this.router.add(e, s, [a, o]), this.routes.push(o);
}, "Y"), Ie = /* @__PURE__ */ __name2(function(e, s) {
  if (e instanceof Error)
    return this.errorHandler(e, s);
  throw e;
}, "Ie"), Le = /* @__PURE__ */ __name2(function(e, s, a, o) {
  if (o === "HEAD")
    return (async () => new Response(null, await x(this, w, Le).call(this, e, s, a, "GET")))();
  const i = this.getPath(e, { env: a }), n = this.router.match(o, i), d = new Ft(e, { path: i, matchResult: n, env: a, executionCtx: s, notFoundHandler: r(this, D) });
  if (n[0].length === 1) {
    let c;
    try {
      c = n[0][0][0][0](d, async () => {
        d.res = await r(this, D).call(this, d);
      });
    } catch (p) {
      return x(this, w, Ie).call(this, p, d);
    }
    return c instanceof Promise ? c.then((p) => p || (d.finalized ? d.res : r(this, D).call(this, d))).catch((p) => x(this, w, Ie).call(this, p, d)) : c ?? r(this, D).call(this, d);
  }
  const l = Ke(n[0], this.errorHandler, r(this, D));
  return (async () => {
    try {
      const c = await l(d);
      if (!c.finalized)
        throw new Error("Context is not finalized. Did you forget to return a Response object or `await next()`?");
      return c.res;
    } catch (c) {
      return x(this, w, Ie).call(this, c, d);
    }
  })();
}, "Le"), ue);
var ht = [];
function Vt(t, e) {
  const s = this.buildAllMatchers(), a = /* @__PURE__ */ __name2((o, i) => {
    const n = s[o] || s[v], d = n[2][i];
    if (d)
      return d;
    const l = i.match(n[0]);
    if (!l)
      return [[], ht];
    const c = l.indexOf("", 1);
    return [n[1][c], l];
  }, "a");
  return this.match = a, a(t, e);
}
__name(Vt, "Vt");
__name2(Vt, "Vt");
var $e = "[^/]+";
var ke = ".*";
var Se = "(?:|/.*)";
var le = Symbol();
var Gt = new Set(".\\+*[^]$()");
function Kt(t, e) {
  return t.length === 1 ? e.length === 1 ? t < e ? -1 : 1 : -1 : e.length === 1 || t === ke || t === Se ? 1 : e === ke || e === Se ? -1 : t === $e ? 1 : e === $e ? -1 : t.length === e.length ? t < e ? -1 : 1 : e.length - t.length;
}
__name(Kt, "Kt");
__name2(Kt, "Kt");
var Q;
var Z;
var I;
var se;
var Yt = (se = /* @__PURE__ */ __name2(class {
  constructor() {
    h(this, Q);
    h(this, Z);
    h(this, I, /* @__PURE__ */ Object.create(null));
  }
  insert(e, s, a, o, i) {
    if (e.length === 0) {
      if (r(this, Q) !== void 0)
        throw le;
      if (i)
        return;
      g(this, Q, s);
      return;
    }
    const [n, ...d] = e, l = n === "*" ? d.length === 0 ? ["", "", ke] : ["", "", $e] : n === "/*" ? ["", "", Se] : n.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let c;
    if (l) {
      const p = l[1];
      let f = l[2] || $e;
      if (p && l[2] && (f === ".*" || (f = f.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:"), /\((?!\?:)/.test(f))))
        throw le;
      if (c = r(this, I)[f], !c) {
        if (Object.keys(r(this, I)).some((b) => b !== ke && b !== Se))
          throw le;
        if (i)
          return;
        c = r(this, I)[f] = new se(), p !== "" && g(c, Z, o.varIndex++);
      }
      !i && p !== "" && a.push([p, r(c, Z)]);
    } else if (c = r(this, I)[n], !c) {
      if (Object.keys(r(this, I)).some((p) => p.length > 1 && p !== ke && p !== Se))
        throw le;
      if (i)
        return;
      c = r(this, I)[n] = new se();
    }
    c.insert(d, s, a, o, i);
  }
  buildRegExpStr() {
    const s = Object.keys(r(this, I)).sort(Kt).map((a) => {
      const o = r(this, I)[a];
      return (typeof r(o, Z) == "number" ? `(${a})@${r(o, Z)}` : Gt.has(a) ? `\\${a}` : a) + o.buildRegExpStr();
    });
    return typeof r(this, Q) == "number" && s.unshift(`#${r(this, Q)}`), s.length === 0 ? "" : s.length === 1 ? s[0] : "(?:" + s.join("|") + ")";
  }
}, "se"), Q = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakMap(), I = /* @__PURE__ */ new WeakMap(), se);
var je;
var Me;
var et;
var Jt = (et = /* @__PURE__ */ __name2(class {
  constructor() {
    h(this, je, { varIndex: 0 });
    h(this, Me, new Yt());
  }
  insert(t, e, s) {
    const a = [], o = [];
    for (let n = 0; ; ) {
      let d = false;
      if (t = t.replace(/\{[^}]+\}/g, (l) => {
        const c = `@\\${n}`;
        return o[n] = [c, l], n++, d = true, c;
      }), !d)
        break;
    }
    const i = t.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let n = o.length - 1; n >= 0; n--) {
      const [d] = o[n];
      for (let l = i.length - 1; l >= 0; l--)
        if (i[l].indexOf(d) !== -1) {
          i[l] = i[l].replace(d, o[n][1]);
          break;
        }
    }
    return r(this, Me).insert(i, e, a, r(this, je), s), a;
  }
  buildRegExp() {
    let t = r(this, Me).buildRegExpStr();
    if (t === "")
      return [/^$/, [], []];
    let e = 0;
    const s = [], a = [];
    return t = t.replace(/#(\d+)|@(\d+)|\.\*\$/g, (o, i, n) => i !== void 0 ? (s[++e] = Number(i), "$()") : (n !== void 0 && (a[Number(n)] = ++e), "")), [new RegExp(`^${t}`), s, a];
  }
}, "et"), je = /* @__PURE__ */ new WeakMap(), Me = /* @__PURE__ */ new WeakMap(), et);
var Xt = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var Te = /* @__PURE__ */ Object.create(null);
function xt(t) {
  return Te[t] ?? (Te[t] = new RegExp(t === "*" ? "" : `^${t.replace(/\/\*$|([.\\+*[^\]$()])/g, (e, s) => s ? `\\${s}` : "(?:|/.*)")}$`));
}
__name(xt, "xt");
__name2(xt, "xt");
function Qt() {
  Te = /* @__PURE__ */ Object.create(null);
}
__name(Qt, "Qt");
__name2(Qt, "Qt");
function Zt(t) {
  var c;
  const e = new Jt(), s = [];
  if (t.length === 0)
    return Xt;
  const a = t.map((p) => [!/\*|\/:/.test(p[0]), ...p]).sort(([p, f], [b, y]) => p ? 1 : b ? -1 : f.length - y.length), o = /* @__PURE__ */ Object.create(null);
  for (let p = 0, f = -1, b = a.length; p < b; p++) {
    const [y, S, T] = a[p];
    y ? o[S] = [T.map(([L]) => [L, /* @__PURE__ */ Object.create(null)]), ht] : f++;
    let R;
    try {
      R = e.insert(S, f, y);
    } catch (L) {
      throw L === le ? new ut(S) : L;
    }
    y || (s[f] = T.map(([L, m]) => {
      const $ = /* @__PURE__ */ Object.create(null);
      for (m -= 1; m >= 0; m--) {
        const [xe, Be] = R[m];
        $[xe] = Be;
      }
      return [L, $];
    }));
  }
  const [i, n, d] = e.buildRegExp();
  for (let p = 0, f = s.length; p < f; p++)
    for (let b = 0, y = s[p].length; b < y; b++) {
      const S = (c = s[p][b]) == null ? void 0 : c[1];
      if (!S)
        continue;
      const T = Object.keys(S);
      for (let R = 0, L = T.length; R < L; R++)
        S[T[R]] = d[S[T[R]]];
    }
  const l = [];
  for (const p in n)
    l[p] = s[n[p]];
  return [i, l, o];
}
__name(Zt, "Zt");
__name2(Zt, "Zt");
function ie(t, e) {
  if (t) {
    for (const s of Object.keys(t).sort((a, o) => o.length - a.length))
      if (xt(s).test(e))
        return [...t[s]];
  }
}
__name(ie, "ie");
__name2(ie, "ie");
var W;
var q;
var _e;
var yt;
var tt;
var es = (tt = /* @__PURE__ */ __name2(class {
  constructor() {
    h(this, _e);
    u(this, "name", "RegExpRouter");
    h(this, W);
    h(this, q);
    u(this, "match", Vt);
    g(this, W, { [v]: /* @__PURE__ */ Object.create(null) }), g(this, q, { [v]: /* @__PURE__ */ Object.create(null) });
  }
  add(t, e, s) {
    var d;
    const a = r(this, W), o = r(this, q);
    if (!a || !o)
      throw new Error(gt);
    a[t] || [a, o].forEach((l) => {
      l[t] = /* @__PURE__ */ Object.create(null), Object.keys(l[v]).forEach((c) => {
        l[t][c] = [...l[v][c]];
      });
    }), e === "/*" && (e = "*");
    const i = (e.match(/\/:/g) || []).length;
    if (/\*$/.test(e)) {
      const l = xt(e);
      t === v ? Object.keys(a).forEach((c) => {
        var p;
        (p = a[c])[e] || (p[e] = ie(a[c], e) || ie(a[v], e) || []);
      }) : (d = a[t])[e] || (d[e] = ie(a[t], e) || ie(a[v], e) || []), Object.keys(a).forEach((c) => {
        (t === v || t === c) && Object.keys(a[c]).forEach((p) => {
          l.test(p) && a[c][p].push([s, i]);
        });
      }), Object.keys(o).forEach((c) => {
        (t === v || t === c) && Object.keys(o[c]).forEach((p) => l.test(p) && o[c][p].push([s, i]));
      });
      return;
    }
    const n = rt(e) || [e];
    for (let l = 0, c = n.length; l < c; l++) {
      const p = n[l];
      Object.keys(o).forEach((f) => {
        var b;
        (t === v || t === f) && ((b = o[f])[p] || (b[p] = [...ie(a[f], p) || ie(a[v], p) || []]), o[f][p].push([s, i - c + l + 1]));
      });
    }
  }
  buildAllMatchers() {
    const t = /* @__PURE__ */ Object.create(null);
    return Object.keys(r(this, q)).concat(Object.keys(r(this, W))).forEach((e) => {
      t[e] || (t[e] = x(this, _e, yt).call(this, e));
    }), g(this, W, g(this, q, void 0)), Qt(), t;
  }
}, "tt"), W = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakMap(), _e = /* @__PURE__ */ new WeakSet(), yt = /* @__PURE__ */ __name2(function(t) {
  const e = [];
  let s = t === v;
  return [r(this, W), r(this, q)].forEach((a) => {
    const o = a[t] ? Object.keys(a[t]).map((i) => [i, a[t][i]]) : [];
    o.length !== 0 ? (s || (s = true), e.push(...o)) : t !== v && e.push(...Object.keys(a[v]).map((i) => [i, a[v][i]]));
  }), s ? Zt(e) : null;
}, "yt"), tt);
var V;
var P;
var st;
var ts = (st = /* @__PURE__ */ __name2(class {
  constructor(t) {
    u(this, "name", "SmartRouter");
    h(this, V, []);
    h(this, P, []);
    g(this, V, t.routers);
  }
  add(t, e, s) {
    if (!r(this, P))
      throw new Error(gt);
    r(this, P).push([t, e, s]);
  }
  match(t, e) {
    if (!r(this, P))
      throw new Error("Fatal error");
    const s = r(this, V), a = r(this, P), o = s.length;
    let i = 0, n;
    for (; i < o; i++) {
      const d = s[i];
      try {
        for (let l = 0, c = a.length; l < c; l++)
          d.add(...a[l]);
        n = d.match(t, e);
      } catch (l) {
        if (l instanceof ut)
          continue;
        throw l;
      }
      this.match = d.match.bind(d), g(this, V, [d]), g(this, P, void 0);
      break;
    }
    if (i === o)
      throw new Error("Fatal error");
    return this.name = `SmartRouter + ${this.activeRouter.name}`, n;
  }
  get activeRouter() {
    if (r(this, P) || r(this, V).length !== 1)
      throw new Error("No active router has been determined yet.");
    return r(this, V)[0];
  }
}, "st"), V = /* @__PURE__ */ new WeakMap(), P = /* @__PURE__ */ new WeakMap(), st);
var we = /* @__PURE__ */ Object.create(null);
var ss = /* @__PURE__ */ __name2((t) => {
  for (const e in t)
    return true;
  return false;
}, "ss");
var G;
var A;
var ee;
var be;
var k;
var O;
var J;
var he;
var as = (he = /* @__PURE__ */ __name2(class {
  constructor(e, s, a) {
    h(this, O);
    h(this, G);
    h(this, A);
    h(this, ee);
    h(this, be, 0);
    h(this, k, we);
    if (g(this, A, a || /* @__PURE__ */ Object.create(null)), g(this, G, []), e && s) {
      const o = /* @__PURE__ */ Object.create(null);
      o[e] = { handler: s, possibleKeys: [], score: 0 }, g(this, G, [o]);
    }
    g(this, ee, []);
  }
  insert(e, s, a) {
    g(this, be, ++Ge(this, be)._);
    let o = this;
    const i = Dt(s), n = [];
    for (let d = 0, l = i.length; d < l; d++) {
      const c = i[d], p = i[d + 1], f = Tt(c, p), b = Array.isArray(f) ? f[0] : c;
      if (b in r(o, A)) {
        o = r(o, A)[b], f && n.push(f[1]);
        continue;
      }
      r(o, A)[b] = new he(), f && (r(o, ee).push(f), n.push(f[1])), o = r(o, A)[b];
    }
    return r(o, G).push({ [e]: { handler: a, possibleKeys: n.filter((d, l, c) => c.indexOf(d) === l), score: r(this, be) } }), o;
  }
  search(e, s) {
    var p;
    const a = [];
    g(this, k, we);
    let i = [this];
    const n = ot(s), d = [], l = n.length;
    let c = null;
    for (let f = 0; f < l; f++) {
      const b = n[f], y = f === l - 1, S = [];
      for (let R = 0, L = i.length; R < L; R++) {
        const m = i[R], $ = r(m, A)[b];
        $ && (g($, k, r(m, k)), y ? (r($, A)["*"] && x(this, O, J).call(this, a, r($, A)["*"], e, r(m, k)), x(this, O, J).call(this, a, $, e, r(m, k))) : S.push($));
        for (let xe = 0, Be = r(m, ee).length; xe < Be; xe++) {
          const We = r(m, ee)[xe], N = r(m, k) === we ? {} : { ...r(m, k) };
          if (We === "*") {
            const ae = r(m, A)["*"];
            ae && (x(this, O, J).call(this, a, ae, e, r(m, k)), g(ae, k, N), S.push(ae));
            continue;
          }
          const [wt, qe, ye] = We;
          if (!b && !(ye instanceof RegExp))
            continue;
          const j = r(m, A)[wt];
          if (ye instanceof RegExp) {
            if (c === null) {
              c = new Array(l);
              let oe = s[0] === "/" ? 1 : 0;
              for (let me = 0; me < l; me++)
                c[me] = oe, oe += n[me].length + 1;
            }
            const ae = s.substring(c[f]), Pe = ye.exec(ae);
            if (Pe) {
              if (N[qe] = Pe[0], x(this, O, J).call(this, a, j, e, r(m, k), N), ss(r(j, A))) {
                g(j, k, N);
                const oe = ((p = Pe[0].match(/\//)) == null ? void 0 : p.length) ?? 0;
                (d[oe] || (d[oe] = [])).push(j);
              }
              continue;
            }
          }
          (ye === true || ye.test(b)) && (N[qe] = b, y ? (x(this, O, J).call(this, a, j, e, N, r(m, k)), r(j, A)["*"] && x(this, O, J).call(this, a, r(j, A)["*"], e, N, r(m, k))) : (g(j, k, N), S.push(j)));
        }
      }
      const T = d.shift();
      i = T ? S.concat(T) : S;
    }
    return a.length > 1 && a.sort((f, b) => f.score - b.score), [a.map(({ handler: f, params: b }) => [f, b])];
  }
}, "he"), G = /* @__PURE__ */ new WeakMap(), A = /* @__PURE__ */ new WeakMap(), ee = /* @__PURE__ */ new WeakMap(), be = /* @__PURE__ */ new WeakMap(), k = /* @__PURE__ */ new WeakMap(), O = /* @__PURE__ */ new WeakSet(), J = /* @__PURE__ */ __name2(function(e, s, a, o, i) {
  for (let n = 0, d = r(s, G).length; n < d; n++) {
    const l = r(s, G)[n], c = l[a] || l[v], p = {};
    if (c !== void 0 && (c.params = /* @__PURE__ */ Object.create(null), e.push(c), o !== we || i && i !== we))
      for (let f = 0, b = c.possibleKeys.length; f < b; f++) {
        const y = c.possibleKeys[f], S = p[c.score];
        c.params[y] = i != null && i[y] && !S ? i[y] : o[y] ?? (i == null ? void 0 : i[y]), p[c.score] = true;
      }
  }
}, "J"), he);
var te;
var at;
var os = (at = /* @__PURE__ */ __name2(class {
  constructor() {
    u(this, "name", "TrieRouter");
    h(this, te);
    g(this, te, new as());
  }
  add(t, e, s) {
    const a = rt(e);
    if (a) {
      for (let o = 0, i = a.length; o < i; o++)
        r(this, te).insert(t, a[o], s);
      return;
    }
    r(this, te).insert(t, e, s);
  }
  match(t, e) {
    return r(this, te).search(t, e);
  }
}, "at"), te = /* @__PURE__ */ new WeakMap(), at);
var mt = /* @__PURE__ */ __name2(class extends qt {
  constructor(t = {}) {
    super(t), this.router = t.router ?? new ts({ routers: [new es(), new os()] });
  }
}, "mt");
var is = /* @__PURE__ */ __name2((t) => {
  const s = { ...{ origin: "*", allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"], allowHeaders: [], exposeHeaders: [] }, ...t }, a = ((i) => typeof i == "string" ? i === "*" ? s.credentials ? (n) => n || null : () => i : (n) => i === n ? n : null : typeof i == "function" ? i : (n) => i.includes(n) ? n : null)(s.origin), o = ((i) => typeof i == "function" ? i : Array.isArray(i) ? () => i : () => [])(s.allowMethods);
  return async function(n, d) {
    var p;
    function l(f, b) {
      n.res.headers.set(f, b);
    }
    __name(l, "l");
    __name2(l, "l");
    const c = await a(n.req.header("origin") || "", n);
    if (c && l("Access-Control-Allow-Origin", c), s.credentials && l("Access-Control-Allow-Credentials", "true"), (p = s.exposeHeaders) != null && p.length && l("Access-Control-Expose-Headers", s.exposeHeaders.join(",")), n.req.method === "OPTIONS") {
      (s.origin !== "*" || s.credentials) && l("Vary", "Origin"), s.maxAge != null && l("Access-Control-Max-Age", s.maxAge.toString());
      const f = await o(n.req.header("origin") || "", n);
      f.length && l("Access-Control-Allow-Methods", f.join(","));
      let b = s.allowHeaders;
      if (!(b != null && b.length)) {
        const y = n.req.header("Access-Control-Request-Headers");
        y && (b = y.split(/\s*,\s*/));
      }
      return b != null && b.length && (l("Access-Control-Allow-Headers", b.join(",")), n.res.headers.append("Vary", "Access-Control-Request-Headers")), n.res.headers.delete("Content-Length"), n.res.headers.delete("Content-Type"), new Response(null, { headers: n.res.headers, status: 204, statusText: "No Content" });
    }
    await d(), (s.origin !== "*" || s.credentials) && n.header("Vary", "Origin", { append: true });
  };
}, "is");
var E = new mt();
E.use("*", is());
var de = { chainId: 5042002, chainIdHex: "0x4CE2D2", rpc: "https://rpc.arc.network", explorer: "https://testnet.arcscan.app", networkName: "Arc Testnet", contracts: { ShuklyEscrow: "0x0000000000000000000000000000000000000000", USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", EURC: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C2Bef" } };
async function K(t, e) {
  try {
    const a = await (await fetch(de.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: t, params: e, id: 1 }), signal: AbortSignal.timeout(1e4) })).json();
    if (a.error)
      throw new Error(a.error.message);
    return a.result;
  } catch {
    return null;
  }
}
__name(K, "K");
__name2(K, "K");
E.get("/api/arc/stats", async (t) => {
  try {
    const [e, s] = await Promise.all([K("eth_blockNumber", []), K("eth_gasPrice", [])]);
    return t.json({ block: e ? parseInt(e, 16) : 0, gasPrice: s ? (parseInt(s, 16) / 1e9).toFixed(2) : "0", network: de.networkName, chainId: de.chainId, status: "live" });
  } catch {
    return t.json({ block: 0, gasPrice: "0", network: de.networkName, chainId: de.chainId, status: "error" });
  }
});
E.get("/api/arc/transactions", async (t) => {
  try {
    const e = await K("eth_blockNumber", []);
    if (!e)
      return t.json({ txs: [] });
    const s = await K("eth_getBlockByNumber", [e, true]), a = ((s == null ? void 0 : s.transactions) || []).slice(0, 20).map((o) => ({ hash: o.hash, from: o.from, to: o.to || "(contract)", value: o.value ? (parseInt(o.value, 16) / 1e18).toFixed(6) : "0", gasPrice: o.gasPrice ? (parseInt(o.gasPrice, 16) / 1e9).toFixed(2) : "0", blockNumber: parseInt(e, 16) }));
    return t.json({ txs: a, blockNumber: parseInt(e, 16) });
  } catch {
    return t.json({ txs: [] });
  }
});
E.get("/api/arc/balance/:address", async (t) => {
  const e = t.req.param("address");
  try {
    const s = await K("eth_getBalance", [e, "latest"]), a = await K("eth_getTransactionCount", [e, "latest"]);
    return t.json({ address: e, balance: s ? (parseInt(s, 16) / 1e18).toFixed(6) : "0", txCount: a ? parseInt(a, 16) : 0 });
  } catch {
    return t.json({ address: e, balance: "0", txCount: 0 });
  }
});
E.get("/api/arc/escrow-events", async (t) => {
  try {
    const e = await K("eth_blockNumber", []);
    if (!e)
      return t.json({ events: [] });
    const s = parseInt(e, 16), a = "0x" + Math.max(0, s - 2e3).toString(16), i = await K("eth_getLogs", [{ fromBlock: a, toBlock: "latest", address: de.contracts.ShuklyEscrow, topics: ["0x98566ec8f6eb0fe52b22bf89e56b38a1c78a779bed8e49e9e1e76f88c5b33975"] }]), n = (Array.isArray(i) ? i : []).slice(-20).map((d) => {
      var l, c;
      return { orderId32: ((l = d.topics) == null ? void 0 : l[1]) || "", buyer: "0x" + (((c = d.topics) == null ? void 0 : c[2]) || "").slice(-40), amount: d.data && d.data !== "0x" ? (Number(BigInt(d.data)) / 1e6).toFixed(2) : "0", txHash: d.transactionHash, blockNumber: parseInt(d.blockNumber || "0x0", 16) };
    });
    return t.json({ events: n });
  } catch {
    return t.json({ events: [] });
  }
});
function rs(t, e, s) {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${t} \u2014 Shukly Admin</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<script>
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        arc: { 50:'#eff6ff', 100:'#dbeafe', 500:'#3b82f6', 600:'#2563eb', 700:'#1d4ed8', 900:'#1e3a8a' },
        dark: { 800:'#0f172a', 850:'#0d1526', 900:'#080f1e', 950:'#050b15' }
      },
      backgroundImage: {
        'glass': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
        'arc-glow': 'radial-gradient(ellipse at top, rgba(59,130,246,0.15) 0%, transparent 70%)',
      },
      boxShadow: {
        'glass': '0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
        'glow-blue': '0 0 20px rgba(59,130,246,0.3)',
        'glow-red': '0 0 20px rgba(239,68,68,0.3)',
        'glow-green': '0 0 20px rgba(34,197,94,0.3)',
      }
    }
  }
}
<\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
:root{--sidebar-w:260px;}
html,body{height:100%;background:#080f1e;color:#e2e8f0;font-family:'Inter',system-ui,sans-serif;}
.glass{background:rgba(255,255,255,0.04);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);}
.glass-card{background:rgba(255,255,255,0.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;}
.glass-card-sm{background:rgba(255,255,255,0.04);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;}
.glass-dark{background:rgba(0,0,0,0.3);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;}
.sidebar{position:fixed;top:0;left:0;width:var(--sidebar-w);height:100vh;background:linear-gradient(180deg,#0a1628 0%,#080f1e 100%);border-right:1px solid rgba(255,255,255,0.06);overflow-y:auto;z-index:50;transition:transform .3s;}
.main-content{margin-left:var(--sidebar-w);min-height:100vh;background:#080f1e;}
.topbar{background:rgba(8,15,30,0.9);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06);position:sticky;top:0;z-index:40;height:64px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:500;color:#94a3b8;cursor:pointer;transition:all .2s;text-decoration:none;white-space:nowrap;}
.nav-item:hover{background:rgba(59,130,246,0.1);color:#93c5fd;}
.nav-item.active{background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.2);}
.nav-item .icon{width:18px;text-align:center;font-size:13px;}
.nav-section{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.08em;padding:16px 14px 6px;}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;}
.badge-red{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.2);}
.badge-green{background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.2);}
.badge-blue{background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.2);}
.badge-yellow{background:rgba(234,179,8,0.15);color:#facc15;border:1px solid rgba(234,179,8,0.2);}
.badge-purple{background:rgba(168,85,247,0.15);color:#c084fc;border:1px solid rgba(168,85,247,0.2);}
.badge-orange{background:rgba(249,115,22,0.15);color:#fb923c;border:1px solid rgba(249,115,22,0.2);}
.badge-gray{background:rgba(100,116,139,0.15);color:#94a3b8;border:1px solid rgba(100,116,139,0.2);}
.kpi-card{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:20px;position:relative;overflow:hidden;transition:all .3s;}
.kpi-card:hover{border-color:rgba(59,130,246,0.3);box-shadow:0 0 24px rgba(59,130,246,0.1);}
.kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--accent,linear-gradient(90deg,#3b82f6,#8b5cf6));}
.btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:9px;font-size:12px;font-weight:600;border:none;cursor:pointer;transition:all .2s;}
.btn-primary{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;}
.btn-primary:hover{background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 0 20px rgba(59,130,246,0.3);}
.btn-danger{background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.2);}
.btn-danger:hover{background:rgba(239,68,68,0.25);}
.btn-success{background:rgba(34,197,94,0.15);color:#4ade80;border:1px solid rgba(34,197,94,0.2);}
.btn-success:hover{background:rgba(34,197,94,0.25);}
.btn-warning{background:rgba(234,179,8,0.15);color:#facc15;border:1px solid rgba(234,179,8,0.2);}
.btn-warning:hover{background:rgba(234,179,8,0.25);}
.btn-ghost{background:rgba(255,255,255,0.06);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);}
.btn-ghost:hover{background:rgba(255,255,255,0.1);color:#e2e8f0;}
.adm-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px;}
.adm-table th{background:rgba(0,0,0,0.3);color:#64748b;font-weight:600;padding:10px 14px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.06);font-size:10px;text-transform:uppercase;letter-spacing:.06em;}
.adm-table td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);color:#cbd5e1;vertical-align:middle;}
.adm-table tr:last-child td{border-bottom:none;}
.adm-table tbody tr:hover td{background:rgba(59,130,246,0.04);}
.risk-bar{height:6px;border-radius:3px;background:rgba(255,255,255,0.06);}
.risk-fill{height:100%;border-radius:3px;transition:width .5s;}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;}
.modal{background:#0d1526;border:1px solid rgba(255,255,255,0.1);border-radius:20px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 25px 80px rgba(0,0,0,0.6);}
.modal-hd{padding:22px 24px 16px;border-bottom:1px solid rgba(255,255,255,0.08);}
.modal-bd{padding:22px 24px;}
.modal-ft{padding:16px 24px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;justify-content:flex-end;}
.input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:10px 14px;color:#e2e8f0;font-size:13px;outline:none;transition:border-color .2s;}
.input:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.1);}
.select{width:100%;background:#0d1526;border:1px solid rgba(255,255,255,0.1);border-radius:9px;padding:10px 14px;color:#e2e8f0;font-size:13px;outline:none;}
.tab-btn{padding:8px 18px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;border:none;color:#64748b;transition:all .2s;}
.tab-btn.active{background:rgba(59,130,246,0.15);color:#60a5fa;}
.tab-btn:hover:not(.active){color:#94a3b8;}
.pulse-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.pulse-green{background:#22c55e;box-shadow:0 0 8px #22c55e;animation:pulse-g 2s infinite;}
.pulse-red{background:#ef4444;box-shadow:0 0 8px #ef4444;animation:pulse-r 2s infinite;}
.pulse-yellow{background:#eab308;box-shadow:0 0 8px #eab308;}
@keyframes pulse-g{0%,100%{opacity:1;box-shadow:0 0 8px #22c55e}50%{opacity:.7;box-shadow:0 0 16px #22c55e}}
@keyframes pulse-r{0%,100%{opacity:1;box-shadow:0 0 8px #ef4444}50%{opacity:.7;box-shadow:0 0 16px #ef4444}}
.scroll-bar::-webkit-scrollbar{width:5px;height:5px;}
.scroll-bar::-webkit-scrollbar-track{background:transparent;}
.scroll-bar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
.glow-border-blue{box-shadow:0 0 0 1px rgba(59,130,246,0.3),0 0 20px rgba(59,130,246,0.1);}
.glow-border-red{box-shadow:0 0 0 1px rgba(239,68,68,0.3),0 0 20px rgba(239,68,68,0.1);}
.glow-border-green{box-shadow:0 0 0 1px rgba(34,197,94,0.3),0 0 20px rgba(34,197,94,0.1);}
.tx-feed-item{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:10px;font-size:11.5px;animation:slideIn .3s ease;}
@keyframes slideIn{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
.spark-line{display:inline-flex;align-items:flex-end;gap:2px;height:28px;}
.spark-bar{width:4px;background:rgba(59,130,246,0.6);border-radius:2px;transition:height .3s;}
.risk-high{color:#f87171;}
.risk-med{color:#fb923c;}
.risk-low{color:#4ade80;}
.page-section{display:none;}
.page-section.active{display:block;}
.sidebar-logo-glow{filter:drop-shadow(0 0 12px rgba(59,130,246,0.5));}
@media(max-width:768px){
  :root{--sidebar-w:0px;}
  .sidebar{transform:translateX(-100%);}
  .sidebar.open{transform:translateX(0);--sidebar-w:260px;}
}
.count-up{font-variant-numeric:tabular-nums;}
.arc-badge{background:linear-gradient(135deg,rgba(59,130,246,0.2),rgba(139,92,246,0.2));border:1px solid rgba(59,130,246,0.3);border-radius:8px;padding:3px 10px;font-size:11px;color:#93c5fd;font-weight:600;}
</style>
</head>
<body>

<!-- \u2500\u2500 SIDEBAR \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
<aside class="sidebar scroll-bar" id="sidebar">
  <!-- Logo -->
  <div style="padding:20px 16px 12px;border-bottom:1px solid rgba(255,255,255,0.06);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
      <div style="width:38px;height:38px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;" class="sidebar-logo-glow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 9v13h7v-7h4v7h7V9L12 2z" fill="white" opacity=".9"/>
          <path d="M9 14l3-3 3 3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <p style="font-size:15px;font-weight:800;color:#e2e8f0;">Shukly <span style="color:#60a5fa;">Admin</span></p>
        <p style="font-size:10px;color:#475569;font-weight:600;">Control Center</p>
      </div>
    </div>
    <!-- Arc badge -->
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span class="arc-badge"><i class="fas fa-circle" style="font-size:7px;color:#22c55e;margin-right:5px;"></i>Arc Testnet</span>
      <span id="sb-block" style="font-size:10px;color:#475569;">Block #\u2014</span>
    </div>
  </div>

  <!-- Role badge -->
  <div style="padding:10px 14px;">
    <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.15);border-radius:9px;padding:9px 12px;display:flex;align-items:center;gap:8px;">
      <div style="width:30px;height:30px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fas fa-shield-alt" style="color:#fff;font-size:11px;"></i>
      </div>
      <div>
        <p style="font-size:12px;font-weight:700;color:#e2e8f0;" id="sb-role-name">Super Admin</p>
        <p style="font-size:10px;color:#64748b;font-family:monospace;" id="sb-wallet-addr">Not connected</p>
      </div>
    </div>
  </div>

  <!-- Nav -->
  <nav style="padding:6px 10px;">
    <p class="nav-section">Overview</p>
    <a onclick="showPage('dashboard')" id="nav-dashboard" class="nav-item active">
      <span class="icon"><i class="fas fa-chart-pie"></i></span>Dashboard
      <span id="nav-alert-badge" class="badge badge-red ml-auto" style="display:none;">3</span>
    </a>
    <a onclick="showPage('analytics')" id="nav-analytics" class="nav-item">
      <span class="icon"><i class="fas fa-chart-line"></i></span>Analytics
    </a>
    <a onclick="showPage('live-feed')" id="nav-live-feed" class="nav-item">
      <span class="icon"><i class="fas fa-bolt"></i></span>Live Feed
      <span class="pulse-dot pulse-green" style="margin-left:auto;"></span>
    </a>

    <p class="nav-section">Moderation</p>
    <a onclick="showPage('products')" id="nav-products" class="nav-item">
      <span class="icon"><i class="fas fa-boxes"></i></span>Products
      <span id="nav-prod-badge" class="badge badge-yellow ml-auto">12</span>
    </a>
    <a onclick="showPage('sellers')" id="nav-sellers" class="nav-item">
      <span class="icon"><i class="fas fa-store"></i></span>Sellers
    </a>
    <a onclick="showPage('fraud')" id="nav-fraud" class="nav-item">
      <span class="icon"><i class="fas fa-exclamation-triangle"></i></span>Fraud Detection
      <span class="badge badge-red ml-auto">2</span>
    </a>

    <p class="nav-section">Escrow & Finance</p>
    <a onclick="showPage('disputes')" id="nav-disputes" class="nav-item">
      <span class="icon"><i class="fas fa-gavel"></i></span>Disputes
      <span id="nav-disp-badge" class="badge badge-red ml-auto">5</span>
    </a>
    <a onclick="showPage('escrow')" id="nav-escrow" class="nav-item">
      <span class="icon"><i class="fas fa-lock"></i></span>Escrow Control
    </a>
    <a onclick="showPage('treasury')" id="nav-treasury" class="nav-item">
      <span class="icon"><i class="fas fa-university"></i></span>Treasury
    </a>

    <p class="nav-section">Security</p>
    <a onclick="showPage('security')" id="nav-security" class="nav-item">
      <span class="icon"><i class="fas fa-shield-virus"></i></span>Security
      <span class="badge badge-orange ml-auto">1</span>
    </a>
    <a onclick="showPage('blacklist')" id="nav-blacklist" class="nav-item">
      <span class="icon"><i class="fas fa-ban"></i></span>Blacklist
    </a>
    <a onclick="showPage('audit')" id="nav-audit" class="nav-item">
      <span class="icon"><i class="fas fa-clipboard-list"></i></span>Audit Log
    </a>

    <p class="nav-section">System</p>
    <a onclick="showPage('settings')" id="nav-settings" class="nav-item">
      <span class="icon"><i class="fas fa-cog"></i></span>Settings
    </a>
    <a onclick="showPage('access')" id="nav-access" class="nav-item">
      <span class="icon"><i class="fas fa-users-cog"></i></span>Access Control
    </a>
  </nav>

  <!-- Bottom status -->
  <div style="position:absolute;bottom:0;left:0;right:0;padding:14px 16px;border-top:1px solid rgba(255,255,255,0.06);background:#080f1e;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:10px;color:#475569;">Arc Network</span>
      <span id="sb-net-status" class="badge badge-green">Live</span>
    </div>
    <div style="font-size:10px;color:#475569;">
      <span id="sb-gas">Gas: \u2014 Gwei</span> &nbsp;\xB7&nbsp;
      <span id="sb-time" style="font-family:monospace;"></span>
    </div>
  </div>
</aside>

<!-- \u2500\u2500 MAIN \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
<div class="main-content">

  <!-- Topbar -->
  <header class="topbar" style="display:flex;align-items:center;padding:0 24px;gap:16px;">
    <button onclick="toggleSidebar()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;display:none;" id="mobile-menu-btn">
      <i class="fas fa-bars"></i>
    </button>
    <!-- Breadcrumb -->
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
      <span style="color:#475569;">Shukly Store</span>
      <i class="fas fa-chevron-right" style="color:#334155;font-size:9px;"></i>
      <span style="color:#93c5fd;font-weight:600;" id="page-title">Dashboard</span>
    </div>

    <div style="flex:1;"></div>

    <!-- Search -->
    <div style="position:relative;">
      <i class="fas fa-search" style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#475569;font-size:12px;"></i>
      <input type="text" placeholder="Search wallets, orders, products\u2026" class="input" style="width:260px;padding-left:32px;height:36px;font-size:12px;" id="global-search" oninput="handleGlobalSearch(this.value)"/>
    </div>

    <!-- Arc status -->
    <div style="display:flex;align-items:center;gap:6px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:9px;padding:6px 12px;">
      <span class="pulse-dot pulse-green"></span>
      <span style="font-size:11px;color:#4ade80;font-weight:600;">Arc Testnet</span>
      <span style="font-size:11px;color:#475569;" id="tb-block">#\u2014</span>
    </div>

    <!-- Alerts -->
    <button onclick="showPage('security')" style="position:relative;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:9px;width:36px;height:36px;cursor:pointer;color:#94a3b8;">
      <i class="fas fa-bell" style="font-size:14px;"></i>
      <span style="position:absolute;top:-3px;right:-3px;background:#ef4444;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:15px;height:15px;display:flex;align-items:center;justify-content:center;">8</span>
    </button>

    <!-- Admin avatar -->
    <div style="width:36px;height:36px;background:linear-gradient(135deg,#2563eb,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:pointer;" title="Admin Profile">
      <i class="fas fa-user" style="color:#fff;font-size:14px;"></i>
    </div>
  </header>

  <!-- \u2500\u2500 PAGE CONTENT \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
  <main style="padding:24px;" id="main-content">

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 DASHBOARD \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section active" id="page-dashboard">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Dashboard Overview</h1>
        <p style="font-size:13px;color:#64748b;">Real-time Arc Network marketplace intelligence</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:9px;padding:6px 14px;font-size:11px;color:#4ade80;font-weight:600;display:flex;align-items:center;gap:6px;">
          <span class="pulse-dot pulse-green"></span>Live Data
        </div>
        <button class="btn btn-primary" onclick="refreshDashboard()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <!-- KPI Grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
      <div class="kpi-card" style="--accent:linear-gradient(90deg,#3b82f6,#60a5fa);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(59,130,246,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-shopping-bag" style="color:#60a5fa;font-size:16px;"></i>
          </div>
          <span class="badge badge-green">+12%</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#e2e8f0;line-height:1;" id="kpi-orders">\u2014</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Total Orders</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-orders"></div>
      </div>

      <div class="kpi-card" style="--accent:linear-gradient(90deg,#22c55e,#4ade80);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(34,197,94,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-dollar-sign" style="color:#4ade80;font-size:16px;"></i>
          </div>
          <span class="badge badge-green">+8%</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#e2e8f0;line-height:1;" id="kpi-volume">\u2014</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Escrow Volume (USDC)</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-volume"></div>
      </div>

      <div class="kpi-card" style="--accent:linear-gradient(90deg,#f59e0b,#fbbf24);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(245,158,11,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-gavel" style="color:#fbbf24;font-size:16px;"></i>
          </div>
          <span class="badge badge-red">Active</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#e2e8f0;line-height:1;" id="kpi-disputes">5</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Open Disputes</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-disputes"></div>
      </div>

      <div class="kpi-card" style="--accent:linear-gradient(90deg,#8b5cf6,#a78bfa);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(139,92,246,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-store" style="color:#a78bfa;font-size:16px;"></i>
          </div>
          <span class="badge badge-blue">+3</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#e2e8f0;line-height:1;" id="kpi-sellers">\u2014</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Active Sellers</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-sellers"></div>
      </div>

      <div class="kpi-card" style="--accent:linear-gradient(90deg,#ef4444,#f87171);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(239,68,68,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-exclamation-triangle" style="color:#f87171;font-size:16px;"></i>
          </div>
          <span class="badge badge-red">Alert</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#f87171;line-height:1;" id="kpi-fraud">2</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Fraud Alerts</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-fraud"></div>
      </div>

      <div class="kpi-card" style="--accent:linear-gradient(90deg,#06b6d4,#22d3ee);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">
          <div style="width:40px;height:40px;background:rgba(6,182,212,0.15);border-radius:11px;display:flex;align-items:center;justify-content:center;">
            <i class="fas fa-cubes" style="color:#22d3ee;font-size:16px;"></i>
          </div>
          <span class="badge badge-blue">Live</span>
        </div>
        <p style="font-size:26px;font-weight:900;color:#e2e8f0;line-height:1;" id="kpi-block">\u2014</p>
        <p style="font-size:12px;color:#64748b;margin-top:5px;font-weight:500;">Arc Block Height</p>
        <div class="spark-line" style="margin-top:10px;" id="spark-block"></div>
      </div>
    </div>

    <!-- Main grid: charts + feed -->
    <div style="display:grid;grid-template-columns:1fr 380px;gap:20px;margin-bottom:20px;">
      <!-- Volume chart -->
      <div class="glass-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">
          <div>
            <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;">Escrow Volume \u2014 Arc USDC</h3>
            <p style="font-size:11px;color:#64748b;margin-top:2px;">Last 30 days</p>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="tab-btn active" onclick="switchChart('volume','30d',this)">30D</button>
            <button class="tab-btn" onclick="switchChart('volume','7d',this)">7D</button>
            <button class="tab-btn" onclick="switchChart('volume','24h',this)">24H</button>
          </div>
        </div>
        <canvas id="chart-volume" style="height:200px;max-height:200px;"></canvas>
      </div>

      <!-- Live Arc Feed -->
      <div class="glass-card" style="padding:0;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;">
          <div>
            <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;">Live Arc Feed</h3>
            <p style="font-size:11px;color:#64748b;margin-top:2px;">Latest transactions</p>
          </div>
          <span class="pulse-dot pulse-green"></span>
        </div>
        <div id="dash-tx-feed" class="scroll-bar" style="height:236px;overflow-y:auto;">
          <div style="padding:30px;text-align:center;color:#475569;font-size:12px;">
            <div style="width:32px;height:32px;border:2px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px;"></div>
            Loading Arc transactions\u2026
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom grid: alerts + recent orders + risk -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
      <!-- Active Alerts -->
      <div class="glass-card" style="padding:0;overflow:hidden;">
        <div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;"><i class="fas fa-bell text-red-400 mr-2"></i>Active Alerts</h3>
            <span class="badge badge-red">8</span>
          </div>
        </div>
        <div style="padding:12px 16px;display:flex;flex-direction:column;gap:8px;">
          ${ns()}
        </div>
      </div>

      <!-- Dispute summary -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:14px;"><i class="fas fa-gavel" style="color:#fbbf24;margin-right:8px;"></i>Dispute Status</h3>
        <canvas id="chart-disputes" style="height:140px;max-height:140px;"></canvas>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;">
          <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.15);border-radius:9px;padding:10px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#f87171;">5</p>
            <p style="font-size:10px;color:#64748b;margin-top:2px;">Open</p>
          </div>
          <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.15);border-radius:9px;padding:10px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#4ade80;">23</p>
            <p style="font-size:10px;color:#64748b;margin-top:2px;">Resolved</p>
          </div>
        </div>
      </div>

      <!-- Risk Overview -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:14px;"><i class="fas fa-shield-alt" style="color:#60a5fa;margin-right:8px;"></i>Risk Overview</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${ls()}
        </div>
      </div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 ANALYTICS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-analytics">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Analytics</h1>
        <p style="font-size:13px;color:#64748b;">Arc Network marketplace performance metrics</p>
      </div>
      <div style="display:flex;gap:8px;">
        <select class="select" style="width:auto;font-size:12px;padding:7px 12px;">
          <option>Last 30 days</option><option>Last 7 days</option><option>Last 24h</option>
        </select>
        <button class="btn btn-ghost"><i class="fas fa-download"></i>Export</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:16px;">Order Volume & Revenue</h3>
        <canvas id="chart-analytics-main" style="height:220px;max-height:220px;"></canvas>
      </div>
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:16px;">Escrow State Distribution</h3>
        <canvas id="chart-escrow-dist" style="height:220px;max-height:220px;"></canvas>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:20px;">
      ${ds()}
    </div>

    <div class="glass-card">
      <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:16px;">Top Sellers by Volume</h3>
      <table class="adm-table">
        <thead><tr><th>#</th><th>Wallet</th><th>Sales</th><th>Volume (USDC)</th><th>Disputes</th><th>Risk</th><th>Status</th></tr></thead>
        <tbody>${cs()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 LIVE FEED \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-live-feed">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Live Arc Network Feed</h1>
        <p style="font-size:13px;color:#64748b;">Real-time transaction monitoring \xB7 Chain ID 5042002</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:9px;padding:6px 14px;font-size:11px;color:#4ade80;font-weight:600;display:flex;align-items:center;gap:6px;">
          <span class="pulse-dot pulse-green"></span>
          <span id="feed-block-label">Block #\u2014</span>
        </div>
        <button class="btn btn-ghost" onclick="toggleFeedPause()" id="feed-pause-btn"><i class="fas fa-pause"></i>Pause</button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 320px;gap:20px;">
      <!-- Main feed table -->
      <div class="glass-card" style="padding:0;overflow:hidden;">
        <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;">
          <div style="display:flex;gap:6px;">
            <button class="tab-btn active" onclick="switchFeedFilter('all',this)">All Txs</button>
            <button class="tab-btn" onclick="switchFeedFilter('escrow',this)">Escrow</button>
            <button class="tab-btn" onclick="switchFeedFilter('transfer',this)">Transfers</button>
          </div>
          <div style="flex:1;"></div>
          <span style="font-size:11px;color:#64748b;" id="feed-count">0 transactions</span>
        </div>
        <div class="scroll-bar" style="max-height:480px;overflow-y:auto;" id="live-feed-table">
          <div style="padding:40px;text-align:center;color:#475569;">
            <i class="fas fa-bolt" style="font-size:32px;margin-bottom:12px;color:#3b82f6;display:block;"></i>
            Loading Arc Network data\u2026
          </div>
        </div>
      </div>

      <!-- Stats sidebar -->
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div class="glass-card">
          <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;">Block Info</h3>
          <div style="display:flex;flex-direction:column;gap:10px;" id="block-info-panel">
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:#64748b;">Block</span><span style="color:#e2e8f0;font-family:monospace;" id="bi-block">\u2014</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:#64748b;">Gas Price</span><span style="color:#e2e8f0;" id="bi-gas">\u2014</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:#64748b;">Network</span><span class="badge badge-green">Arc Testnet</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:#64748b;">Chain ID</span><span style="color:#e2e8f0;font-family:monospace;">5042002</span>
            </div>
          </div>
        </div>
        <div class="glass-card">
          <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;">Escrow Events</h3>
          <div id="escrow-events-panel" class="scroll-bar" style="max-height:200px;overflow-y:auto;">
            <div style="text-align:center;padding:20px;color:#475569;font-size:12px;">Loading\u2026</div>
          </div>
        </div>
        <div class="glass-card">
          <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:10px;">Wallet Lookup</h3>
          <input type="text" class="input" placeholder="0x\u2026 address" id="wallet-lookup-input" style="margin-bottom:8px;font-size:12px;font-family:monospace;"/>
          <button class="btn btn-primary" style="width:100%;justify-content:center;" onclick="lookupWallet()"><i class="fas fa-search"></i>Lookup</button>
          <div id="wallet-lookup-result" style="margin-top:10px;display:none;"></div>
        </div>
      </div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 PRODUCT MODERATION \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-products">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Product Moderation</h1>
        <p style="font-size:13px;color:#64748b;">Review, flag, pause, or remove marketplace listings</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input type="text" class="input" placeholder="Search products\u2026" style="width:200px;font-size:12px;" oninput="filterProducts(this.value)"/>
        <select class="select" style="width:130px;font-size:12px;" id="prod-status-filter" onchange="filterProducts()">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="flagged">Flagged</option>
          <option value="removed">Removed</option>
        </select>
        <button class="btn btn-ghost" onclick="loadProducts()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#4ade80;" id="prod-stat-active">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Active</p>
      </div>
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#facc15;" id="prod-stat-flagged">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Flagged</p>
      </div>
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#fb923c;" id="prod-stat-paused">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Paused</p>
      </div>
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#f87171;" id="prod-stat-removed">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Removed</p>
      </div>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden;">
      <table class="adm-table" id="products-table">
        <thead><tr>
          <th><input type="checkbox" id="prod-select-all" onchange="toggleSelectAll('prod-row-cb')"/></th>
          <th>Product</th><th>Seller</th><th>Price</th><th>Status</th>
          <th>AI Risk</th><th>Views</th><th>Created</th><th>Actions</th>
        </tr></thead>
        <tbody id="products-tbody">
          <tr><td colspan="9" style="text-align:center;padding:40px;color:#475569;">
            <div style="width:32px;height:32px;border:2px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px;"></div>
            Loading products\u2026
          </td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 SELLER MANAGEMENT \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-sellers">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Seller Management</h1>
        <p style="font-size:13px;color:#64748b;">Monitor, suspend, and manage Arc Network sellers</p>
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" class="input" placeholder="Search wallet\u2026" style="width:220px;font-size:12px;font-family:monospace;" oninput="filterSellers(this.value)"/>
        <button class="btn btn-ghost" onclick="loadSellers()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden;">
      <table class="adm-table">
        <thead><tr>
          <th>Wallet</th><th>Products</th><th>Sales</th><th>Volume (USDC)</th>
          <th>Disputes</th><th>Risk Score</th><th>Status</th><th>Joined</th><th>Actions</th>
        </tr></thead>
        <tbody id="sellers-tbody">${ps()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 FRAUD DETECTION \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-fraud">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Fraud Detection</h1>
        <p style="font-size:13px;color:#64748b;">AI-powered risk scoring and suspicious activity monitoring</p>
      </div>
      <div style="display:flex;gap:8px;">
        <span class="badge badge-red" style="padding:6px 14px;font-size:12px;"><i class="fas fa-exclamation-triangle mr-1"></i>2 Critical Alerts</span>
        <button class="btn btn-ghost"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <!-- Alert cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      ${fs()}
    </div>

    <!-- Risk score table -->
    <div class="glass-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;"><i class="fas fa-robot mr-2" style="color:#8b5cf6;"></i>AI Risk Scoring \u2014 All Wallets</h3>
        <div style="display:flex;gap:6px;">
          <button class="tab-btn active">All</button>
          <button class="tab-btn">High Risk</button>
          <button class="tab-btn">Suspicious</button>
        </div>
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Wallet</th><th>Risk Score</th><th>Risk Factors</th><th>Orders</th>
          <th>Disputes</th><th>Last Activity</th><th>Actions</th>
        </tr></thead>
        <tbody>${gs()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 DISPUTES \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-disputes">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Dispute Arbitration</h1>
        <p style="font-size:13px;color:#64748b;">Manage and resolve escrow disputes on Arc Network</p>
      </div>
      <div style="display:flex;gap:8px;">
        <select class="select" style="width:140px;font-size:12px;">
          <option>All Disputes</option><option>Open</option><option>Resolved</option><option>Escalated</option>
        </select>
        <button class="btn btn-ghost" onclick="loadDisputes()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;">
      <div class="glass-card-sm" style="border-color:rgba(239,68,68,0.2);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:rgba(239,68,68,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-fire" style="color:#f87171;"></i></div>
          <div><p style="font-size:22px;font-weight:900;color:#f87171;">5</p><p style="font-size:11px;color:#64748b;">Open</p></div>
        </div>
      </div>
      <div class="glass-card-sm">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:rgba(234,179,8,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-clock" style="color:#facc15;"></i></div>
          <div><p style="font-size:22px;font-weight:900;color:#facc15;">3</p><p style="font-size:11px;color:#64748b;">Pending Review</p></div>
        </div>
      </div>
      <div class="glass-card-sm">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:rgba(34,197,94,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-check" style="color:#4ade80;"></i></div>
          <div><p style="font-size:22px;font-weight:900;color:#4ade80;">23</p><p style="font-size:11px;color:#64748b;">Resolved</p></div>
        </div>
      </div>
      <div class="glass-card-sm">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:rgba(59,130,246,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-dollar-sign" style="color:#60a5fa;"></i></div>
          <div><p style="font-size:22px;font-weight:900;color:#60a5fa;">2.4K</p><p style="font-size:11px;color:#64748b;">USDC in Dispute</p></div>
        </div>
      </div>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:9px;padding:10px 14px;font-size:12px;color:#fbbf24;">
          <i class="fas fa-info-circle mr-2"></i>
          <strong>Arbitration uses existing smart contract functions only.</strong> Refund \u2192 <code>refundBuyer()</code>, Release \u2192 <code>releaseFunds()</code>. No contract modifications.
        </div>
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Order ID</th><th>Buyer</th><th>Seller</th><th>Amount</th>
          <th>Status</th><th>Evidence</th><th>Age</th><th>Actions</th>
        </tr></thead>
        <tbody id="disputes-tbody">${us()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 ESCROW CONTROL \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-escrow">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Escrow Control</h1>
        <p style="font-size:13px;color:#64748b;">Monitor and manage Arc Network escrow contracts</p>
      </div>
      <div style="display:flex;gap:8px;">
        <span class="arc-badge"><i class="fas fa-lock mr-1"></i>ShuklyEscrow</span>
        <button class="btn btn-ghost" onclick="loadEscrow()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <!-- Contract info -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="glass-card" style="border-color:rgba(59,130,246,0.2);">
        <h3 style="font-size:13px;font-weight:700;color:#93c5fd;margin-bottom:14px;"><i class="fas fa-file-contract mr-2"></i>Contract Details</h3>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="color:#64748b;">Address</span>
            <code style="color:#93c5fd;font-size:11px;background:rgba(59,130,246,0.08);padding:3px 8px;border-radius:5px;" id="escrow-contract-addr">Loading\u2026</code>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">Network</span><span class="badge badge-green">Arc Testnet</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">Chain ID</span><span style="color:#e2e8f0;font-family:monospace;">5042002</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">USDC Token</span>
            <code style="color:#4ade80;font-size:11px;">0x1c7D\u202638</code>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:#64748b;">Status</span><span class="badge badge-green">Active</span>
          </div>
        </div>
      </div>
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;"><i class="fas fa-chart-bar mr-2 text-blue-400"></i>Escrow Statistics</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:9px;padding:12px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#60a5fa;" id="esc-total-locked">\u2014</p>
            <p style="font-size:10px;color:#64748b;margin-top:3px;">Locked USDC</p>
          </div>
          <div style="background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.15);border-radius:9px;padding:12px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#4ade80;" id="esc-total-released">\u2014</p>
            <p style="font-size:10px;color:#64748b;margin-top:3px;">Released</p>
          </div>
          <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:9px;padding:12px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#f87171;" id="esc-disputed">\u2014</p>
            <p style="font-size:10px;color:#64748b;margin-top:3px;">In Dispute</p>
          </div>
          <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.15);border-radius:9px;padding:12px;text-align:center;">
            <p style="font-size:20px;font-weight:900;color:#c084fc;" id="esc-total-events">\u2014</p>
            <p style="font-size:10px;color:#64748b;margin-top:3px;">Total Events</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Escrow events table -->
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;">Recent EscrowFunded Events</h3>
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Order ID (bytes32)</th><th>Buyer</th><th>Amount</th><th>Tx Hash</th>
          <th>Block</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody id="escrow-events-tbody">
          <tr><td colspan="7" style="text-align:center;padding:30px;color:#475569;">Loading on-chain data\u2026</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 TREASURY \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-treasury">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Treasury</h1>
        <p style="font-size:13px;color:#64748b;">Arc USDC flow, fee collection, and financial oversight</p>
      </div>
      <button class="btn btn-ghost"><i class="fas fa-download"></i>Export CSV</button>
    </div>

    <!-- Financial KPIs -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px;">
      <div class="kpi-card" style="--accent:linear-gradient(90deg,#22c55e,#4ade80);">
        <p style="font-size:11px;color:#64748b;margin-bottom:8px;">TOTAL VOLUME PROCESSED</p>
        <p style="font-size:28px;font-weight:900;color:#4ade80;font-variant-numeric:tabular-nums;">$18,420</p>
        <p style="font-size:11px;color:#64748b;margin-top:5px;">USDC on Arc Testnet</p>
      </div>
      <div class="kpi-card" style="--accent:linear-gradient(90deg,#3b82f6,#60a5fa);">
        <p style="font-size:11px;color:#64748b;margin-bottom:8px;">FEES COLLECTED</p>
        <p style="font-size:28px;font-weight:900;color:#60a5fa;">$552</p>
        <p style="font-size:11px;color:#64748b;margin-top:5px;">Platform fee (3%)</p>
      </div>
      <div class="kpi-card" style="--accent:linear-gradient(90deg,#f59e0b,#fbbf24);">
        <p style="font-size:11px;color:#64748b;margin-bottom:8px;">ESCROWED (ACTIVE)</p>
        <p style="font-size:28px;font-weight:900;color:#fbbf24;">$3,240</p>
        <p style="font-size:11px;color:#64748b;margin-top:5px;">Locked in escrow</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-bottom:20px;">
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:16px;">USDC Flow (Arc Network)</h3>
        <canvas id="chart-treasury" style="height:200px;max-height:200px;"></canvas>
      </div>
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;">Token Distribution</h3>
        <canvas id="chart-tokens" style="height:140px;max-height:140px;"></canvas>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;">
          <div style="background:rgba(59,130,246,0.08);border-radius:8px;padding:9px;text-align:center;">
            <p style="font-size:16px;font-weight:700;color:#60a5fa;">78%</p>
            <p style="font-size:10px;color:#64748b;">USDC</p>
          </div>
          <div style="background:rgba(34,197,94,0.08);border-radius:8px;padding:9px;text-align:center;">
            <p style="font-size:16px;font-weight:700;color:#4ade80;">22%</p>
            <p style="font-size:10px;color:#64748b;">EURC</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction history -->
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;">Recent Transactions</h3>
      </div>
      <table class="adm-table">
        <thead><tr><th>Tx Hash</th><th>Type</th><th>From</th><th>To</th><th>Amount (USDC)</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>${bs()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 SECURITY \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-security">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Security Center</h1>
        <p style="font-size:13px;color:#64748b;">Platform security monitoring and threat detection</p>
      </div>
      <span class="badge badge-yellow" style="padding:6px 14px;font-size:12px;"><i class="fas fa-exclamation-triangle mr-1"></i>1 Active Threat</span>
    </div>

    <!-- Threat level -->
    <div class="glass-card" style="border-color:rgba(234,179,8,0.3);margin-bottom:20px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <div style="width:56px;height:56px;background:rgba(234,179,8,0.15);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-shield-alt" style="color:#fbbf24;font-size:24px;"></i>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px;">
            <h3 style="font-size:16px;font-weight:800;color:#fbbf24;">ELEVATED</h3>
            <span class="badge badge-yellow">Threat Level</span>
          </div>
          <p style="font-size:12px;color:#94a3b8;">Unusual transaction pattern detected from wallet 0x9f3a\u2026 \u2014 under review. No funds at risk.</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-warning"><i class="fas fa-eye"></i>Review</button>
          <button class="btn btn-ghost"><i class="fas fa-times"></i>Dismiss</button>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
      <!-- Security Events -->
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;"><i class="fas fa-history mr-2 text-blue-400"></i>Recent Security Events</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${hs()}
        </div>
      </div>
      <!-- Access Control Summary -->
      <div class="glass-card">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:14px;"><i class="fas fa-users-shield mr-2 text-purple-400"></i>Admin Access Summary</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${xs()}
        </div>
      </div>
    </div>

    <!-- Security rules -->
    <div class="glass-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h3 style="font-size:13px;font-weight:700;color:#e2e8f0;"><i class="fas fa-sliders-h mr-2 text-blue-400"></i>Security Rules</h3>
        <button class="btn btn-primary"><i class="fas fa-plus"></i>Add Rule</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${ys()}
      </div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 BLACKLIST \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-blacklist">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Wallet Blacklist</h1>
        <p style="font-size:13px;color:#64748b;">Manage blocked wallets on Arc Network</p>
      </div>
      <button class="btn btn-danger" onclick="openBlacklistModal()"><i class="fas fa-ban"></i>Blacklist Wallet</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px;">
      <div class="glass-card-sm" style="text-align:center;border-color:rgba(239,68,68,0.2);">
        <p style="font-size:22px;font-weight:900;color:#f87171;" id="bl-total">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Total Blacklisted</p>
      </div>
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#fb923c;" id="bl-sellers">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Sellers Blocked</p>
      </div>
      <div class="glass-card-sm" style="text-align:center;">
        <p style="font-size:22px;font-weight:900;color:#fbbf24;" id="bl-buyers">\u2014</p>
        <p style="font-size:11px;color:#64748b;margin-top:3px;">Buyers Blocked</p>
      </div>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden;">
      <table class="adm-table">
        <thead><tr>
          <th>Wallet Address</th><th>Role</th><th>Reason</th><th>Blocked By</th>
          <th>Date</th><th>Severity</th><th>Actions</th>
        </tr></thead>
        <tbody id="blacklist-tbody">${ws()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 AUDIT LOG \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-audit">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Audit Log</h1>
        <p style="font-size:13px;color:#64748b;">Immutable record of all admin actions</p>
      </div>
      <div style="display:flex;gap:8px;">
        <input type="text" class="input" placeholder="Filter by action, admin, target\u2026" style="width:260px;font-size:12px;" oninput="filterAudit(this.value)"/>
        <button class="btn btn-ghost" onclick="exportAuditLog()"><i class="fas fa-download"></i>Export</button>
        <button class="btn btn-ghost" onclick="loadAuditLog()"><i class="fas fa-sync-alt"></i>Refresh</button>
      </div>
    </div>

    <div class="glass-card" style="padding:0;overflow:hidden;">
      <table class="adm-table">
        <thead><tr>
          <th>Timestamp</th><th>Admin</th><th>Role</th><th>Action</th>
          <th>Target</th><th>Details</th><th>Chain</th>
        </tr></thead>
        <tbody id="audit-tbody">${ks()}</tbody>
      </table>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 SETTINGS \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-settings">
    <div style="margin-bottom:24px;">
      <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Settings</h1>
      <p style="font-size:13px;color:#64748b;">Platform configuration and admin preferences</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
      <!-- Platform settings -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:18px;"><i class="fas fa-sliders-h mr-2 text-blue-400"></i>Platform Settings</h3>
        <div style="display:flex;flex-direction:column;gap:16px;">
          ${ms()}
        </div>
      </div>

      <!-- Arc Network settings -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:18px;"><i class="fas fa-network-wired mr-2 text-green-400"></i>Arc Network Configuration</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">RPC Endpoint</label>
            <input class="input" value="https://rpc.arc.network" style="font-size:12px;font-family:monospace;"/>
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Block Explorer</label>
            <input class="input" value="https://testnet.arcscan.app" style="font-size:12px;font-family:monospace;"/>
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Chain ID</label>
            <input class="input" value="5042002" style="font-size:12px;font-family:monospace;" readonly/>
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">ShuklyEscrow Contract</label>
            <input class="input" id="escrow-addr-setting" style="font-size:11px;font-family:monospace;" placeholder="0x\u2026"/>
          </div>
          <button class="btn btn-primary" style="justify-content:center;margin-top:4px;"><i class="fas fa-save"></i>Save Network Config</button>
        </div>
      </div>

      <!-- Notification settings -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:18px;"><i class="fas fa-bell mr-2 text-yellow-400"></i>Alert Thresholds</h3>
        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Fraud Risk Alert Threshold</label>
            <div style="display:flex;align-items:center;gap:10px;">
              <input type="range" min="0" max="100" value="70" class="input" style="padding:0;" oninput="this.nextElementSibling.textContent=this.value+'%'"/>
              <span style="font-size:13px;font-weight:700;color:#f87171;min-width:40px;">70%</span>
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Auto-freeze Escrow on Dispute</label>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
              <input type="checkbox" checked style="width:16px;height:16px;accent-color:#3b82f6;"/>
              <span style="font-size:12px;color:#94a3b8;">Automatically freeze escrow when dispute is opened</span>
            </label>
          </div>
          <div>
            <label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Large Transaction Alert (USDC)</label>
            <input type="number" class="input" value="500" style="font-size:12px;"/>
          </div>
        </div>
      </div>

      <!-- Maintenance -->
      <div class="glass-card">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;margin-bottom:18px;"><i class="fas fa-tools mr-2 text-orange-400"></i>Maintenance</h3>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <button class="btn btn-danger" style="justify-content:center;"><i class="fas fa-power-off"></i>Enable Maintenance Mode</button>
          <button class="btn btn-warning" style="justify-content:center;"><i class="fas fa-pause-circle"></i>Pause New Registrations</button>
          <button class="btn btn-ghost" style="justify-content:center;"><i class="fas fa-trash"></i>Clear Audit Log Cache</button>
          <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:9px;padding:12px;font-size:11px;color:#f87171;">
            <i class="fas fa-exclamation-triangle mr-2"></i>
            These actions affect all marketplace users. Use with caution.
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 ACCESS CONTROL (RBAC) \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 -->
  <section class="page-section" id="page-access">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:22px;font-weight:800;color:#e2e8f0;margin-bottom:3px;">Access Control</h1>
        <p style="font-size:13px;color:#64748b;">Role-based access control for admin panel</p>
      </div>
      <button class="btn btn-primary" onclick="openAddAdminModal()"><i class="fas fa-user-plus"></i>Add Admin</button>
    </div>

    <!-- Roles -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px;">
      ${vs()}
    </div>

    <!-- Admins table -->
    <div class="glass-card" style="padding:0;overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);">
        <h3 style="font-size:14px;font-weight:700;color:#e2e8f0;">Admin Accounts</h3>
      </div>
      <table class="adm-table">
        <thead><tr>
          <th>Wallet</th><th>Role</th><th>Permissions</th><th>Last Login</th><th>Added By</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody id="access-tbody">${Ss()}</tbody>
      </table>
    </div>
  </section>

  </main><!-- /main-content -->
</div><!-- /main -->

<!-- \u2500\u2500 MODALS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
<div id="modal-root"></div>

<!-- \u2500\u2500 TOAST \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 -->
<div id="toast-container" style="position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:8px;"></div>

<style>
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.toast-item{animation:fadeInUp .3s ease;min-width:280px;max-width:400px;background:#0d1526;border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:12px;font-size:13px;box-shadow:0 10px 40px rgba(0,0,0,0.5);}
.toast-success{border-left:3px solid #22c55e;}
.toast-error{border-left:3px solid #ef4444;}
.toast-info{border-left:3px solid #3b82f6;}
.toast-warning{border-left:3px solid #f59e0b;}
</style>

<script>
// \u2500\u2500 Config \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var ARC_CONFIG = {
  rpc: 'https://rpc.arc.network',
  explorer: 'https://testnet.arcscan.app',
  chainId: 5042002,
  contracts: { ShuklyEscrow: '', USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', EURC: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C2Bef' }
};

// \u2500\u2500 Storage keys \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var KEYS = {
  WHITELIST: 'adm_whitelist',
  AUDIT:     'adm_audit',
  BANNED:    'adm_banned',
  BLACKLIST: 'adm_blacklist',
  SETTINGS:  'adm_settings',
  PRODUCTS:  'rh_products',
  ORDERS:    'rh_orders'
};

// \u2500\u2500 State \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var _feedPaused = false;
var _feedInterval = null;
var _arcInterval  = null;
var _allProducts  = [];
var _allSellers   = [];
var _allAudit     = [];
var _txFeed       = [];
var _feedFilter   = 'all';
var _currentPage  = 'dashboard';
var _charts       = {};

// \u2500\u2500 Utilities \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function short(a,s,e){ if(!a||a.length<10) return a||'\u2014'; s=s||8; e=e||6; return a.slice(0,s)+'\u2026'+a.slice(-e); }
function getAudit(){ try{ return JSON.parse(localStorage.getItem(KEYS.AUDIT)||'[]'); }catch(e){ return []; } }
function addAudit(action, target, detail, chain){
  var log = getAudit();
  var w = getMyWallet();
  log.unshift({ ts:new Date().toISOString(), admin:w||'unknown', role:getMyRole(), action, target:target||'\u2014', detail:detail||'', chain:chain||'Arc Testnet' });
  if(log.length>1000) log=log.slice(0,1000);
  localStorage.setItem(KEYS.AUDIT, JSON.stringify(log));
}
function getMyWallet(){ try{ var w=JSON.parse(localStorage.getItem('rh_wallet')||'{}'); return w.address||null; }catch(e){ return null; } }
function getMyRole(){ return localStorage.getItem('adm_my_role')||'Super Admin'; }
function getBanned(){ try{ return JSON.parse(localStorage.getItem(KEYS.BANNED)||'[]'); }catch(e){ return []; } }
function getBlacklist(){ try{ return JSON.parse(localStorage.getItem(KEYS.BLACKLIST)||'[]'); }catch(e){ return []; } }
function getOrders(){ try{ return JSON.parse(localStorage.getItem(KEYS.ORDERS)||'[]'); }catch(e){ return []; } }

function showToast(msg, type){
  type = type||'info';
  var c = document.getElementById('toast-container');
  if(!c) return;
  var icons = { success:'fa-check-circle', error:'fa-times-circle', info:'fa-info-circle', warning:'fa-exclamation-triangle' };
  var colors = { success:'#22c55e', error:'#ef4444', info:'#3b82f6', warning:'#f59e0b' };
  var el = document.createElement('div');
  el.className = 'toast-item toast-'+type;
  el.innerHTML = '<i class="fas '+icons[type]+'" style="color:'+colors[type]+';font-size:16px;flex-shrink:0;"></i><span style="color:#e2e8f0;">'+esc(msg)+'</span><button onclick="this.parentNode.remove()" style="background:none;border:none;color:#64748b;cursor:pointer;margin-left:auto;font-size:16px;">&times;</button>';
  c.appendChild(el);
  setTimeout(function(){ el.remove(); }, 4500);
}

// \u2500\u2500 Routing \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function showPage(id){
  // Hide all
  document.querySelectorAll('.page-section').forEach(function(s){ s.classList.remove('active'); });
  // Remove active from nav
  document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.remove('active'); });

  var page = document.getElementById('page-'+id);
  if(page) page.classList.add('active');

  var nav = document.getElementById('nav-'+id);
  if(nav) nav.classList.add('active');

  var titles = {
    dashboard:'Dashboard','analytics':'Analytics','live-feed':'Live Feed',
    products:'Product Moderation','sellers':'Seller Management',
    fraud:'Fraud Detection','disputes':'Disputes','escrow':'Escrow Control',
    treasury:'Treasury','security':'Security','blacklist':'Blacklist',
    audit:'Audit Log','settings':'Settings','access':'Access Control'
  };
  var ptEl = document.getElementById('page-title');
  if(ptEl) ptEl.textContent = titles[id]||id;
  _currentPage = id;

  // Lazy-load page data
  if(id==='analytics') initAnalyticsCharts();
  if(id==='live-feed') initLiveFeed();
  if(id==='products') loadProducts();
  if(id==='sellers') loadSellers();
  if(id==='disputes') loadDisputes();
  if(id==='escrow') loadEscrow();
  if(id==='treasury') initTreasuryCharts();
  if(id==='blacklist') loadBlacklist();
  if(id==='audit') loadAuditLog();
  if(id==='access') loadAccess();
}

function toggleSidebar(){
  document.getElementById('sidebar').classList.toggle('open');
}

// \u2500\u2500 Arc Network polling \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function fetchArcStats(){
  try {
    var r = await fetch('/api/arc/stats', { signal: AbortSignal.timeout(8000) });
    var d = await r.json();
    if(d.block){
      var bn = '#'+d.block.toLocaleString();
      var g = d.gasPrice+' Gwei';
      ['sb-block','tb-block'].forEach(function(id){ var el=document.getElementById(id); if(el) el.textContent=bn; });
      var gEl = document.getElementById('sb-gas'); if(gEl) gEl.textContent='Gas: '+g;
      var biG = document.getElementById('bi-gas'); if(biG) biG.textContent=g;
      var biB = document.getElementById('bi-block'); if(biB) biB.textContent=d.block.toLocaleString();
      var kpiB = document.getElementById('kpi-block'); if(kpiB) kpiB.textContent=d.block.toLocaleString();
      var fbl = document.getElementById('feed-block-label'); if(fbl) fbl.textContent='Block '+bn;
    }
    var t = document.getElementById('sb-time');
    if(t) t.textContent=new Date().toLocaleTimeString();
  } catch(e){ /* silent */ }
}

async function fetchTxFeed(){
  if(_feedPaused) return;
  try {
    var r = await fetch('/api/arc/transactions', { signal: AbortSignal.timeout(10000) });
    var d = await r.json();
    if(Array.isArray(d.txs) && d.txs.length){
      _txFeed = d.txs.slice(0, 20);
      renderDashFeed();
      renderLiveFeedTable();
    }
  } catch(e){ /* silent */ }
}

async function fetchEscrowEvents(){
  try {
    var r = await fetch('/api/arc/escrow-events', { signal: AbortSignal.timeout(12000) });
    var d = await r.json();
    if(Array.isArray(d.events)){
      renderEscrowEventsSidebar(d.events);
      renderEscrowEventsTable(d.events);
    }
  } catch(e){ /* silent */ }
}

// \u2500\u2500 Dashboard feed rendering \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function renderDashFeed(){
  var el = document.getElementById('dash-tx-feed');
  if(!el) return;
  if(!_txFeed.length){
    el.innerHTML='<div style="padding:20px;text-align:center;color:#475569;font-size:12px;">No transactions in latest block</div>';
    return;
  }
  var html = _txFeed.map(function(tx){
    var isTo = tx.to && tx.to !== '(contract)';
    var valColor = parseFloat(tx.value)>0 ? '#4ade80' : '#94a3b8';
    return '<div class="tx-feed-item">'+
      '<div style="width:30px;height:30px;border-radius:8px;background:rgba(59,130,246,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">'+
        '<i class="fas fa-arrow-right" style="color:#60a5fa;font-size:10px;"></i></div>'+
      '<div style="flex:1;min-width:0;">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;">'+
          '<code style="font-size:10px;color:#93c5fd;">'+short(tx.hash,10,6)+'</code>'+
          '<span style="font-size:11px;font-weight:700;color:'+valColor+';">'+tx.value+' ARC</span>'+
        '</div>'+
        '<div style="display:flex;gap:6px;margin-top:2px;">'+
          '<span style="font-size:10px;color:#475569;">From '+short(tx.from,6,4)+'</span>'+
          '<span style="font-size:10px;color:#334155;">\u2192</span>'+
          '<span style="font-size:10px;color:#475569;">'+(isTo?short(tx.to,6,4):'contract')+'</span>'+
        '</div>'+
      '</div>'+
      '<a href="'+ARC_CONFIG.explorer+'/tx/'+tx.hash+'" target="_blank" style="color:#475569;font-size:10px;text-decoration:none;flex-shrink:0;">'+
        '<i class="fas fa-external-link-alt"></i></a>'+
      '</div>';
  }).join('');
  el.innerHTML = html;
}

function renderLiveFeedTable(){
  var el = document.getElementById('live-feed-table');
  if(!el) return;
  var cEl = document.getElementById('feed-count');
  if(cEl) cEl.textContent = _txFeed.length+' transactions';

  if(!_txFeed.length){
    el.innerHTML='<div style="padding:40px;text-align:center;color:#475569;font-size:12px;">No transactions found</div>';
    return;
  }

  var filtered = _txFeed.filter(function(tx){
    if(_feedFilter==='all') return true;
    if(_feedFilter==='transfer') return parseFloat(tx.value)>0;
    if(_feedFilter==='escrow') return !tx.to || tx.to==='(contract)';
    return true;
  });

  var html = '<table class="adm-table"><thead><tr>'+
    '<th>Tx Hash</th><th>From</th><th>To</th><th>Value</th><th>Gas</th><th>Block</th><th>Link</th>'+
    '</tr></thead><tbody>'+
    filtered.map(function(tx){
      var isZero = parseFloat(tx.value)===0;
      return '<tr>'+
        '<td><code style="font-size:10px;color:#93c5fd;">'+esc(short(tx.hash,12,6))+'</code></td>'+
        '<td><code style="font-size:10px;">'+esc(short(tx.from,8,4))+'</code></td>'+
        '<td><code style="font-size:10px;">'+esc(tx.to==='(contract)'?'\u{1F4C4} contract':short(tx.to,8,4))+'</code></td>'+
        '<td><span style="color:'+(isZero?'#475569':'#4ade80');'font-weight:600;">'+esc(tx.value)+'</span></td>'+
        '<td style="color:#64748b;">'+esc(tx.gasPrice)+' Gwei</td>'+
        '<td style="font-family:monospace;color:#60a5fa;">'+esc(String(tx.blockNumber))+'</td>'+
        '<td><a href="'+ARC_CONFIG.explorer+'/tx/'+esc(tx.hash)+'" target="_blank" style="color:#60a5fa;font-size:11px;"><i class="fas fa-external-link-alt"></i></a></td>'+
        '</tr>';
    }).join('')+
    '</tbody></table>';
  el.innerHTML = html;
}

function renderEscrowEventsSidebar(events){
  var el = document.getElementById('escrow-events-panel');
  if(!el) return;
  if(!events.length){
    el.innerHTML='<div style="padding:16px;text-align:center;color:#475569;font-size:11px;">No recent escrow events</div>';
    return;
  }
  el.innerHTML = events.slice(0,8).map(function(e){
    return '<div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;">'+
      '<div style="display:flex;justify-content:space-between;margin-bottom:2px;">'+
        '<span class="badge badge-blue">EscrowFunded</span>'+
        '<span style="color:#4ade80;font-weight:700;">$'+esc(e.amount)+'</span>'+
      '</div>'+
      '<div style="color:#475569;">Buyer: <code>'+esc(short(e.buyer,8,4))+'</code></div>'+
      '<div style="color:#475569;margin-top:2px;"><a href="'+ARC_CONFIG.explorer+'/tx/'+esc(e.txHash)+'" target="_blank" style="color:#60a5fa;">'+esc(short(e.txHash,10,4))+'</a></div>'+
    '</div>';
  }).join('');
}

// \u2500\u2500 Dashboard charts \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function initDashboardCharts(){
  // Volume chart
  var ctx = document.getElementById('chart-volume');
  if(ctx && !_charts.volume){
    var labels = [];
    var data = [];
    for(var i=29;i>=0;i--){
      var d=new Date(); d.setDate(d.getDate()-i);
      labels.push(d.toLocaleDateString('en',{month:'short',day:'numeric'}));
      data.push(Math.floor(Math.random()*800+200));
    }
    _charts.volume = new Chart(ctx, {
      type:'line',
      data:{
        labels,
        datasets:[{
          label:'USDC Volume',
          data,
          borderColor:'#3b82f6',
          backgroundColor:'rgba(59,130,246,0.08)',
          tension:.4,
          fill:true,
          pointRadius:0,
          borderWidth:2
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return'$'+c.parsed.y.toLocaleString()+' USDC';}}}},
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',maxTicksLimit:6,font:{size:10}}},
          y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',font:{size:10},callback:function(v){return'$'+v;}}}
        }
      }
    });
  }

  // Disputes doughnut
  var ctx2 = document.getElementById('chart-disputes');
  if(ctx2 && !_charts.disputes){
    _charts.disputes = new Chart(ctx2, {
      type:'doughnut',
      data:{
        labels:['Open','Pending','Resolved','Escalated'],
        datasets:[{
          data:[5,3,23,1],
          backgroundColor:['rgba(239,68,68,0.7)','rgba(234,179,8,0.7)','rgba(34,197,94,0.7)','rgba(168,85,247,0.7)'],
          borderColor:'transparent',
          borderWidth:0
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        cutout:'70%',
        plugins:{legend:{display:false}}
      }
    });
  }

  // Sparklines
  renderSparklines();
}

function renderSparklines(){
  var sparks = ['orders','volume','disputes','sellers','fraud','block'];
  sparks.forEach(function(k){
    var el = document.getElementById('spark-'+k);
    if(!el||el.innerHTML) return;
    var bars = '';
    for(var i=0;i<8;i++){
      var h = Math.floor(Math.random()*22+4);
      bars += '<div class="spark-bar" style="height:'+h+'px;"></div>';
    }
    el.innerHTML = bars;
  });
}

function initAnalyticsCharts(){
  // Main analytics chart
  var ctx = document.getElementById('chart-analytics-main');
  if(ctx && !_charts.analyticsMain){
    var labels=[]; var orders=[]; var revenue=[];
    for(var i=29;i>=0;i--){
      var d=new Date(); d.setDate(d.getDate()-i);
      labels.push(d.toLocaleDateString('en',{month:'short',day:'numeric'}));
      orders.push(Math.floor(Math.random()*30+5));
      revenue.push(Math.floor(Math.random()*1200+200));
    }
    _charts.analyticsMain = new Chart(ctx,{
      type:'bar',
      data:{
        labels,
        datasets:[
          {label:'Orders',data:orders,backgroundColor:'rgba(59,130,246,0.5)',borderRadius:4,yAxisID:'y'},
          {label:'Revenue (USDC)',data:revenue,backgroundColor:'rgba(34,197,94,0.4)',borderRadius:4,yAxisID:'y1',type:'line',tension:.4,fill:false,borderColor:'#22c55e',pointRadius:0}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',maxTicksLimit:8,font:{size:10}}},
          y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',font:{size:10}},position:'left'},
          y1:{grid:{display:false},ticks:{color:'#64748b',font:{size:10},callback:function(v){return'$'+v;}},position:'right'}
        }
      }
    });
  }

  // Escrow state distribution
  var ctx2 = document.getElementById('chart-escrow-dist');
  if(ctx2 && !_charts.escrowDist){
    _charts.escrowDist = new Chart(ctx2,{
      type:'doughnut',
      data:{
        labels:['Funded','Confirmed','Released','Refunded','Disputed'],
        datasets:[{
          data:[18,12,45,8,5],
          backgroundColor:['rgba(59,130,246,.7)','rgba(34,197,94,.7)','rgba(168,85,247,.7)','rgba(234,179,8,.7)','rgba(239,68,68,.7)'],
          borderColor:'transparent',borderWidth:0
        }]
      },
      options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
        plugins:{legend:{position:'right',labels:{color:'#94a3b8',font:{size:11},padding:8}}}}
    });
  }
}

function initTreasuryCharts(){
  var ctx = document.getElementById('chart-treasury');
  if(ctx && !_charts.treasury){
    var labels=[]; var inflow=[]; var outflow=[];
    for(var i=29;i>=0;i--){
      var d=new Date(); d.setDate(d.getDate()-i);
      labels.push(d.toLocaleDateString('en',{month:'short',day:'numeric'}));
      inflow.push(Math.floor(Math.random()*800+100));
      outflow.push(Math.floor(Math.random()*600+80));
    }
    _charts.treasury = new Chart(ctx,{
      type:'line',
      data:{
        labels,
        datasets:[
          {label:'Inflow',data:inflow,borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,0.08)',tension:.4,fill:true,pointRadius:0,borderWidth:2},
          {label:'Outflow',data:outflow,borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.05)',tension:.4,fill:true,pointRadius:0,borderWidth:2}
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{labels:{color:'#94a3b8',font:{size:11}}}},
        scales:{
          x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',maxTicksLimit:6,font:{size:10}}},
          y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#475569',font:{size:10},callback:function(v){return'$'+v;}}}
        }
      }
    });
  }
  var ctx2 = document.getElementById('chart-tokens');
  if(ctx2 && !_charts.tokens){
    _charts.tokens = new Chart(ctx2,{
      type:'doughnut',
      data:{labels:['USDC','EURC'],datasets:[{data:[78,22],backgroundColor:['rgba(59,130,246,.8)','rgba(34,197,94,.8)'],borderColor:'transparent',borderWidth:0}]},
      options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false}}}
    });
  }
}

function switchChart(type, period, btn){
  document.querySelectorAll('[onclick^="switchChart"]').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  // Could refresh chart data here
}

// \u2500\u2500 Product Moderation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function loadProducts(){
  var tbody = document.getElementById('products-tbody');
  if(!tbody) return;
  tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:30px;color:#475569;"><div style="width:24px;height:24px;border:2px solid #3b82f6;border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 8px;"></div>Loading\u2026</td></tr>';
  try {
    var r = await fetch('/api/products?limit=100', { signal: AbortSignal.timeout(10000) });
    if(!r.ok) throw new Error('API error');
    var d = await r.json();
    _allProducts = Array.isArray(d.products) ? d.products : generateMockProducts();
  } catch(e){
    _allProducts = generateMockProducts();
  }
  renderProducts(_allProducts);
}

function generateMockProducts(){
  var cats = ['Electronics','Gaming','Fashion','Audio','Photography','Books'];
  var statuses = ['active','active','active','flagged','paused','removed'];
  return Array.from({length:18},function(_,i){
    var risk = Math.floor(Math.random()*100);
    return {
      id:'PROD-'+String(i+1).padStart(4,'0'),
      title:['Pro Gaming Headset','Wireless Keyboard','Smart Watch','Camera Lens','USB-C Hub','Mechanical Keyboard','Laptop Stand','Drone Camera','VR Headset','LED Strip'][i%10],
      seller_id:'0x'+Math.random().toString(16).slice(2,42),
      price:(Math.random()*200+10).toFixed(2),
      token:Math.random()>0.3?'USDC':'EURC',
      status:statuses[Math.floor(Math.random()*statuses.length)],
      category:cats[Math.floor(Math.random()*cats.length)],
      views:Math.floor(Math.random()*500+50),
      risk:risk,
      createdAt:new Date(Date.now()-Math.random()*30*864e5).toISOString()
    };
  });
}

function renderProducts(products){
  var tbody = document.getElementById('products-tbody');
  if(!tbody) return;
  var counts = {active:0,flagged:0,paused:0,removed:0};
  products.forEach(function(p){ if(counts[p.status]!==undefined) counts[p.status]++; });
  ['active','flagged','paused','removed'].forEach(function(k){
    var el=document.getElementById('prod-stat-'+k); if(el) el.textContent=counts[k];
  });
  if(!products.length){ tbody.innerHTML='<tr><td colspan="9" style="text-align:center;padding:30px;color:#475569;">No products found.</td></tr>'; return; }
  tbody.innerHTML = products.map(function(p){
    var risk = p.risk||0;
    var riskColor = risk>70?'#f87171':risk>40?'#fb923c':'#4ade80';
    var riskLabel = risk>70?'HIGH':risk>40?'MED':'LOW';
    var statusBadge = {
      active:'<span class="badge badge-green">Active</span>',
      flagged:'<span class="badge badge-yellow">Flagged</span>',
      paused:'<span class="badge badge-orange">Paused</span>',
      removed:'<span class="badge badge-red">Removed</span>'
    }[p.status]||'<span class="badge badge-gray">Unknown</span>';
    return '<tr>'+
      '<td><input type="checkbox" class="prod-row-cb" data-id="'+esc(p.id)+'"/></td>'+
      '<td>'+
        '<div style="font-weight:600;color:#e2e8f0;font-size:12px;">'+esc(p.title)+'</div>'+
        '<div style="font-size:10px;color:#475569;margin-top:2px;">'+esc(p.id)+' \xB7 '+esc(p.category)+'</div>'+
      '</td>'+
      '<td><code style="font-size:10px;color:#93c5fd;">'+esc(short(p.seller_id,8,4))+'</code></td>'+
      '<td style="font-weight:700;color:#4ade80;">$'+esc(p.price)+' <span style="color:#64748b;font-weight:400;">'+esc(p.token)+'</span></td>'+
      '<td>'+statusBadge+'</td>'+
      '<td>'+
        '<div style="display:flex;align-items:center;gap:8px;">'+
          '<div class="risk-bar" style="width:60px;"><div class="risk-fill" style="width:'+risk+'%;background:'+riskColor+';"></div></div>'+
          '<span style="font-size:11px;color:'+riskColor+';font-weight:700;">'+risk+'% '+riskLabel+'</span>'+
        '</div>'+
      '</td>'+
      '<td style="color:#94a3b8;">'+esc(String(p.views||0))+'</td>'+
      '<td style="color:#64748b;font-size:11px;">'+new Date(p.createdAt).toLocaleDateString()+'</td>'+
      '<td>'+
        '<div style="display:flex;gap:5px;">'+
          (p.status==='active'?'<button class="btn btn-warning" style="padding:4px 8px;font-size:10px;" onclick="moderateProduct(&#39;'+esc(p.id)+'&#39;,&#39;pause&#39;)"><i class="fas fa-pause"></i></button>':'<button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="moderateProduct(&#39;'+esc(p.id)+'&#39;,&#39;resume&#39;)"><i class="fas fa-play"></i></button>')+
          '<button class="btn btn-danger" style="padding:4px 8px;font-size:10px;" onclick="moderateProduct(&#39;'+esc(p.id)+'&#39;,&#39;remove&#39;)"><i class="fas fa-trash"></i></button>'+
          '<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="viewProduct(&#39;'+esc(p.id)+'&#39;)"><i class="fas fa-eye"></i></button>'+
        '</div>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function filterProducts(q){
  q = (q||document.querySelector('#products-table ~ * input')?.value||'').toLowerCase();
  var sf = (document.getElementById('prod-status-filter')||{}).value||'all';
  var filtered = _allProducts.filter(function(p){
    var matchQ = !q || (p.title||'').toLowerCase().includes(q) || (p.seller_id||'').toLowerCase().includes(q);
    var matchS = sf==='all' || p.status===sf;
    return matchQ && matchS;
  });
  renderProducts(filtered);
}

function toggleSelectAll(cls){
  var state = document.getElementById('prod-select-all').checked;
  document.querySelectorAll('.'+cls).forEach(function(cb){ cb.checked=state; });
}

async function moderateProduct(id, action){
  var reason = action==='remove' ? prompt('Reason for '+action+' (required):','Policy violation') : action;
  if(action==='remove' && !reason) return;
  addAudit('product_'+action, id, reason);
  var p = _allProducts.find(function(x){ return x.id===id; });
  if(p){ p.status = action==='pause'?'paused':action==='resume'?'active':'removed'; }
  renderProducts(_allProducts);
  showToast('Product '+action+'d \u2014 audit logged','success');
}

function viewProduct(id){
  var p = _allProducts.find(function(x){ return x.id===id; });
  if(!p) return;
  showModal('<div style="display:flex;flex-direction:column;gap:12px;font-size:13px;">'+
    '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">ID</span><code>'+esc(p.id)+'</code></div>'+
    '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Title</span><span>'+esc(p.title)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Price</span><span style="color:#4ade80;">$'+esc(p.price)+' '+esc(p.token)+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Seller</span><code style="font-size:11px;">'+esc(p.seller_id)+'</code></div>'+
    '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Risk Score</span><span style="color:'+( p.risk>70?'#f87171':p.risk>40?'#fb923c':'#4ade80')+';font-weight:700;">'+p.risk+'%</span></div>'+
    '</div>',
    'Product: '+p.title, null);
}

// \u2500\u2500 Sellers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadSellers(){
  var tbody = document.getElementById('sellers-tbody');
  if(!tbody) return;
  _allSellers = generateMockSellers();
  tbody.innerHTML = _allSellers.map(function(s){ return renderSellerRow(s); }).join('');
}

function generateMockSellers(){
  var statuses = ['active','active','active','suspended','banned'];
  return Array.from({length:12},function(_,i){
    var risk = Math.floor(Math.random()*100);
    return {
      address:'0x'+Math.random().toString(16).slice(2,42),
      products:Math.floor(Math.random()*20+1),
      sales:Math.floor(Math.random()*50),
      volume:(Math.random()*5000+100).toFixed(2),
      disputes:Math.floor(Math.random()*5),
      risk,
      status:statuses[Math.floor(Math.random()*statuses.length)],
      joined:new Date(Date.now()-Math.random()*90*864e5).toISOString()
    };
  });
}

function renderSellerRow(s){
  var risk = s.risk||0;
  var rC = risk>70?'#f87171':risk>40?'#fb923c':'#4ade80';
  var statusBadge = {
    active:'<span class="badge badge-green">Active</span>',
    suspended:'<span class="badge badge-yellow">Suspended</span>',
    banned:'<span class="badge badge-red">Banned</span>'
  }[s.status]||'<span class="badge badge-gray">\u2014</span>';
  return '<tr>'+
    '<td><code style="font-size:11px;color:#93c5fd;">'+esc(short(s.address))+'</code></td>'+
    '<td style="text-align:center;font-weight:600;">'+s.products+'</td>'+
    '<td style="text-align:center;font-weight:600;">'+s.sales+'</td>'+
    '<td style="font-weight:700;color:#4ade80;">$'+esc(s.volume)+'</td>'+
    '<td style="text-align:center;color:'+(s.disputes>2?'#f87171':'#94a3b8')+';">'+s.disputes+'</td>'+
    '<td>'+
      '<div style="display:flex;align-items:center;gap:6px;">'+
        '<div class="risk-bar" style="width:50px;"><div class="risk-fill" style="width:'+risk+'%;background:'+rC+'"></div></div>'+
        '<span style="font-size:11px;color:'+rC+';font-weight:600;">'+risk+'</span>'+
      '</div>'+
    '</td>'+
    '<td>'+statusBadge+'</td>'+
    '<td style="color:#64748b;font-size:11px;">'+new Date(s.joined).toLocaleDateString()+'</td>'+
    '<td>'+
      '<div style="display:flex;gap:5px;">'+
        (s.status==='active'?'<button class="btn btn-warning" style="padding:4px 8px;font-size:10px;" onclick="suspendSeller(&#39;'+esc(s.address)+'&#39;)"><i class="fas fa-user-slash"></i></button>':'<button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="unsuspendSeller(&#39;'+esc(s.address)+'&#39;)"><i class="fas fa-user-check"></i></button>')+
        '<button class="btn btn-danger" style="padding:4px 8px;font-size:10px;" onclick="banSeller(&#39;'+esc(s.address)+'&#39;)"><i class="fas fa-ban"></i></button>'+
        '<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="viewSellerDetails(&#39;'+esc(s.address)+'&#39;)"><i class="fas fa-chart-bar"></i></button>'+
      '</div>'+
    '</td>'+
    '</tr>';
}

function filterSellers(q){
  q = (q||'').toLowerCase();
  var filtered = q ? _allSellers.filter(function(s){ return s.address.toLowerCase().includes(q); }) : _allSellers;
  var tbody = document.getElementById('sellers-tbody');
  if(tbody) tbody.innerHTML = filtered.map(function(s){ return renderSellerRow(s); }).join('');
}

function suspendSeller(addr){
  var reason = prompt('Reason for suspension:','Suspicious activity');
  if(!reason) return;
  var s = _allSellers.find(function(x){ return x.address===addr; });
  if(s){ s.status='suspended'; }
  var tbody = document.getElementById('sellers-tbody');
  if(tbody) tbody.innerHTML = _allSellers.map(function(s){ return renderSellerRow(s); }).join('');
  addAudit('seller_suspend', addr, reason);
  showToast('Seller suspended \u2014 audit logged','warning');
}

function unsuspendSeller(addr){
  var s = _allSellers.find(function(x){ return x.address===addr; });
  if(s){ s.status='active'; }
  loadSellers();
  addAudit('seller_unsuspend', addr, 'Re-activated by admin');
  showToast('Seller re-activated','success');
}

function banSeller(addr){
  var reason = prompt('Ban reason (required):','Fraud / Policy violation');
  if(!reason) return;
  var s = _allSellers.find(function(x){ return x.address===addr; });
  if(s){ s.status='banned'; }
  var banned = getBanned(); var a=addr.toLowerCase();
  if(!banned.includes(a)) banned.push(a);
  localStorage.setItem(KEYS.BANNED, JSON.stringify(banned));
  loadSellers();
  addAudit('seller_ban', addr, reason);
  showToast('Seller banned','error');
}

function viewSellerDetails(addr){
  var s = _allSellers.find(function(x){ return x.address===addr; });
  if(!s) return;
  showModal(
    '<div style="font-size:13px;">'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#64748b;">Wallet</span><code style="font-size:11px;color:#93c5fd;">'+esc(s.address)+'</code></div>'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#64748b;">Products</span><span>'+s.products+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#64748b;">Total Sales</span><span>'+s.sales+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#64748b;">Volume</span><span style="color:#4ade80;">$'+esc(s.volume)+' USDC</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="color:#64748b;">Disputes</span><span style="color:'+( s.disputes>2?'#f87171':'#94a3b8')+'">'+s.disputes+'</span></div>'+
    '<div style="display:flex;justify-content:space-between;padding:8px 0;"><span style="color:#64748b;">Risk Score</span><span style="font-weight:700;color:'+( s.risk>70?'#f87171':s.risk>40?'#fb923c':'#4ade80')+'">'+s.risk+'/100</span></div>'+
    '<a href="'+ARC_CONFIG.explorer+'/address/'+esc(s.address)+'" target="_blank" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px;text-decoration:none;"><i class="fas fa-external-link-alt"></i> View on Arc Explorer</a>'+
    '</div>',
    'Seller Details', null);
}

// \u2500\u2500 Disputes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadDisputes(){
  var tbody = document.getElementById('disputes-tbody');
  if(!tbody) return;
  var orders = getOrders();
  var disputes = orders.filter(function(o){ return o.status==='dispute'||o.disputeResolution; });
  if(!disputes.length) disputes = generateMockDisputes();
  tbody.innerHTML = disputes.map(function(d){
    var resolved = !!d.disputeResolution;
    var statusBadge = resolved
      ? '<span class="badge badge-green">Resolved: '+esc(d.disputeResolution)+'</span>'
      : '<span class="badge badge-red"><i class="fas fa-fire" style="font-size:9px;"></i> Open</span>';
    var age = Math.floor((Date.now()-new Date(d.disputedAt||d.createdAt||Date.now()).getTime())/864e5);
    return '<tr>'+
      '<td><code style="font-size:10px;color:#93c5fd;">'+esc((d.id||'').slice(0,14))+'\u2026</code></td>'+
      '<td><code style="font-size:10px;">'+esc(short(d.buyerAddress||d.buyer,8,4))+'</code></td>'+
      '<td><code style="font-size:10px;">'+esc(short(d.sellerAddress||d.seller,8,4))+'</code></td>'+
      '<td style="font-weight:700;color:#4ade80;">$'+esc(String(d.amount||'\u2014'))+' <span style="color:#64748b;font-size:10px;">'+esc(d.token||'USDC')+'</span></td>'+
      '<td>'+statusBadge+'</td>'+
      '<td style="text-align:center;color:#64748b;">'+((d.evidence||[]).length||0)+'</td>'+
      '<td style="color:'+(age>3?'#f87171':'#94a3b8')+'">'+age+'d</td>'+
      '<td>'+
        (resolved
          ? '<span style="color:#475569;font-size:11px;">\u2014</span>'
          : '<div style="display:flex;gap:5px;">'+
              '<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="viewDispute(&#39;'+esc(d.id)+'&#39;)"><i class="fas fa-eye"></i></button>'+
              '<button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="resolveDispute(&#39;'+esc(d.id)+'&#39;,&#39;refund&#39;)"><i class="fas fa-undo"></i>Refund</button>'+
              '<button class="btn btn-primary" style="padding:4px 8px;font-size:10px;" onclick="resolveDispute(&#39;'+esc(d.id)+'&#39;,&#39;release&#39;)"><i class="fas fa-coins"></i>Release</button>'+
            '</div>')+
      '</td>'+
    '</tr>';
  }).join('');
}

function generateMockDisputes(){
  return Array.from({length:5},function(_,i){
    return {
      id:'ORD-176'+i+'00-abc',
      buyerAddress:'0x'+Math.random().toString(16).slice(2,42),
      sellerAddress:'0x'+Math.random().toString(16).slice(2,42),
      amount:(Math.random()*500+50).toFixed(2),
      token:'USDC',
      status:'dispute',
      disputedAt:new Date(Date.now()-Math.random()*7*864e5).toISOString(),
      evidence:[]
    };
  });
}

function resolveDispute(id, action){
  var reason = prompt('Reason for '+action+' decision (required):','');
  if(!reason) return;
  addAudit('dispute_resolve', id, action+' \u2014 '+reason, 'Arc Testnet (on-chain)');
  showToast('Dispute resolved: '+action+' \u2014 audit logged','success');
  loadDisputes();
}

function viewDispute(id){
  showToast('Opening dispute details for '+id,'info');
}

// \u2500\u2500 Escrow \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function loadEscrow(){
  var addr = document.getElementById('escrow-contract-addr');
  if(addr) addr.textContent = ARC_CONFIG.contracts.ShuklyEscrow||'Not configured';
  await fetchEscrowEvents();
}

function renderEscrowEventsTable(events){
  var tbody = document.getElementById('escrow-events-tbody');
  if(!tbody) return;
  var total = document.getElementById('esc-total-events');
  if(total) total.textContent = events.length;
  if(!events.length){
    tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:30px;color:#475569;">No EscrowFunded events found in recent blocks</td></tr>';
    return;
  }
  tbody.innerHTML = events.map(function(e){
    return '<tr>'+
      '<td><code style="font-size:10px;color:#8b5cf6;">'+esc(short(e.orderId32,12,6))+'</code></td>'+
      '<td><code style="font-size:10px;color:#93c5fd;">'+esc(short(e.buyer,8,4))+'</code></td>'+
      '<td style="font-weight:700;color:#4ade80;">$'+esc(e.amount)+' USDC</td>'+
      '<td><a href="'+ARC_CONFIG.explorer+'/tx/'+esc(e.txHash)+'" target="_blank" style="color:#60a5fa;font-size:10px;">'+esc(short(e.txHash,10,4))+'</a></td>'+
      '<td style="font-family:monospace;color:#64748b;">'+esc(String(e.blockNumber))+'</td>'+
      '<td><span class="badge badge-blue">Funded</span></td>'+
      '<td>'+
        '<button class="btn btn-warning" style="padding:4px 8px;font-size:10px;" onclick="showToast(&#39;Freeze requires admin wallet \u2014 connect first&#39;,&#39;warning&#39;)"><i class="fas fa-snowflake"></i>Freeze</button>'+
      '</td>'+
    '</tr>';
  }).join('');
  var locked=0; events.forEach(function(e){ locked+=parseFloat(e.amount)||0; });
  var el=document.getElementById('esc-total-locked'); if(el) el.textContent='$'+locked.toFixed(2);
}

// \u2500\u2500 Blacklist \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadBlacklist(){
  var list = getBlacklist();
  var el = document.getElementById('blacklist-tbody');
  if(!el) return;
  var total=document.getElementById('bl-total'); if(total) total.textContent=list.length;
  var sellers=list.filter(function(x){return x.role==='seller';}).length;
  var buyers=list.filter(function(x){return x.role==='buyer';}).length;
  var bs=document.getElementById('bl-sellers'); if(bs) bs.textContent=sellers;
  var bb=document.getElementById('bl-buyers'); if(bb) bb.textContent=buyers;
  if(!list.length){
    el.innerHTML='<tr><td colspan="7" style="text-align:center;padding:30px;color:#475569;">No blacklisted wallets.</td></tr>';
    return;
  }
  el.innerHTML = list.map(function(b,i){
    var sevColor = {critical:'#f87171',high:'#fb923c',medium:'#fbbf24'}[b.severity]||'#94a3b8';
    var sevBadge = {critical:'badge-red',high:'badge-orange',medium:'badge-yellow'}[b.severity]||'badge-gray';
    return '<tr>'+
      '<td><code style="font-size:11px;color:#93c5fd;">'+esc(b.address)+'</code></td>'+
      '<td><span class="badge badge-blue">'+esc(b.role||'user')+'</span></td>'+
      '<td style="max-width:160px;font-size:11px;color:#94a3b8;">'+esc((b.reason||'').slice(0,50))+'</td>'+
      '<td><code style="font-size:10px;">'+esc(short(b.blockedBy,8,4))+'</code></td>'+
      '<td style="color:#64748b;font-size:11px;">'+new Date(b.date||Date.now()).toLocaleDateString()+'</td>'+
      '<td><span class="badge '+sevBadge+'">'+esc(b.severity||'medium')+'</span></td>'+
      '<td>'+
        '<button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="removeBlacklist('+i+')"><i class="fas fa-unlock"></i></button>'+
        '<button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;margin-left:4px;" onclick="showToast(&#39;Viewing details&#39;,&#39;info&#39;)"><i class="fas fa-eye"></i></button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function openBlacklistModal(){
  var root = document.getElementById('modal-root');
  root.innerHTML = '<div class="modal-overlay" id="bl-overlay">'+
    '<div class="modal">'+
    '<div class="modal-hd"><div style="display:flex;align-items:center;gap:10px;">'+
      '<div style="width:36px;height:36px;background:rgba(239,68,68,0.15);border-radius:9px;display:flex;align-items:center;justify-content:center;"><i class="fas fa-ban" style="color:#f87171;"></i></div>'+
      '<div><p style="font-weight:700;font-size:15px;color:#e2e8f0;">Blacklist Wallet</p></div></div>'+
      '<button onclick="document.getElementById(&#39;modal-root&#39;).innerHTML=&#39;&#39;" style="background:rgba(255,255,255,0.06);border:none;color:#94a3b8;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;">&times;</button>'+
    '</div>'+
    '<div class="modal-bd" style="display:grid;gap:14px;">'+
      '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Wallet Address *</label>'+
      '<input id="bl-addr" class="input" placeholder="0x\u2026" style="font-family:monospace;font-size:12px;"/></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'+
        '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Role</label>'+
        '<select id="bl-role" class="select" style="font-size:12px;"><option value="seller">Seller</option><option value="buyer">Buyer</option><option value="both">Both</option></select></div>'+
        '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Severity</label>'+
        '<select id="bl-sev" class="select" style="font-size:12px;"><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></div>'+
      '</div>'+
      '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Reason *</label>'+
      '<select id="bl-reason" class="select" style="font-size:12px;margin-bottom:6px;"><option>Fraud / Scam</option><option>Fake Products</option><option>Policy Violation</option><option>Harassment</option><option>Money Laundering</option><option>Other</option></select>'+
      '<textarea id="bl-detail" class="input" rows="2" placeholder="Additional details\u2026" style="resize:vertical;"></textarea></div>'+
      '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:9px;padding:10px;font-size:11px;color:#f87171;"><i class="fas fa-exclamation-triangle mr-2"></i>Blacklisted wallets cannot place orders or list products.</div>'+
    '</div>'+
    '<div class="modal-ft">'+
      '<button onclick="document.getElementById(&#39;modal-root&#39;).innerHTML=&#39;&#39;" class="btn btn-ghost">Cancel</button>'+
      '<button onclick="confirmBlacklist()" class="btn btn-danger"><i class="fas fa-ban"></i>Blacklist</button>'+
    '</div>'+
    '</div></div>';
  document.getElementById('bl-overlay').addEventListener('click',function(e){ if(e.target===this) document.getElementById('modal-root').innerHTML=''; });
}

function confirmBlacklist(){
  var addr = (document.getElementById('bl-addr')||{}).value||'';
  if(!addr||!addr.startsWith('0x')||addr.length<10){ showToast('Enter a valid 0x\u2026 address','error'); return; }
  var reason = (document.getElementById('bl-reason')||{}).value||'Unknown';
  var role = (document.getElementById('bl-role')||{}).value||'seller';
  var sev = (document.getElementById('bl-sev')||{}).value||'medium';
  var detail = (document.getElementById('bl-detail')||{}).value||'';
  var list = getBlacklist();
  list.unshift({ address:addr.toLowerCase(), role, reason:reason+(detail?' \u2014 '+detail:''), severity:sev, blockedBy:getMyWallet()||'admin', date:new Date().toISOString() });
  localStorage.setItem(KEYS.BLACKLIST, JSON.stringify(list));
  addAudit('wallet_blacklist', addr, reason+' ('+sev+')', 'Arc Network');
  document.getElementById('modal-root').innerHTML='';
  loadBlacklist();
  showToast('Wallet blacklisted','error');
}

function removeBlacklist(i){
  if(!confirm('Remove this wallet from the blacklist?')) return;
  var list = getBlacklist();
  var addr = list[i]?.address||'';
  list.splice(i,1);
  localStorage.setItem(KEYS.BLACKLIST, JSON.stringify(list));
  addAudit('wallet_unblacklist', addr, 'Removed from blacklist');
  loadBlacklist();
  showToast('Wallet removed from blacklist','success');
}

// \u2500\u2500 Audit Log \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadAuditLog(){
  _allAudit = getAudit();
  if(!_allAudit.length) _allAudit = generateMockAudit();
  renderAudit(_allAudit);
}

function generateMockAudit(){
  var actions = ['product_pause','seller_suspend','dispute_resolve','wallet_blacklist','admin_login','product_remove','user_ban','seller_ban','product_flag'];
  var roles = ['Super Admin','Moderator','Finance','Security'];
  return Array.from({length:20},function(_,i){
    return {
      ts: new Date(Date.now()-i*1800000).toISOString(),
      admin: '0x'+Math.random().toString(16).slice(2,42),
      role: roles[Math.floor(Math.random()*roles.length)],
      action: actions[Math.floor(Math.random()*actions.length)],
      target: '0x'+Math.random().toString(16).slice(2,42),
      detail: 'Policy violation \u2014 reviewed and confirmed',
      chain: 'Arc Testnet'
    };
  });
}

function renderAudit(log){
  var tbody = document.getElementById('audit-tbody');
  if(!tbody) return;
  var actionColors = {
    product_pause:'badge-yellow', product_remove:'badge-red', product_flag:'badge-orange',
    seller_suspend:'badge-orange', seller_ban:'badge-red', user_ban:'badge-red',
    dispute_resolve:'badge-green', wallet_blacklist:'badge-red', admin_login:'badge-blue',
    seller_unsuspend:'badge-green', wallet_unblacklist:'badge-green'
  };
  if(!log.length){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:30px;color:#475569;">No audit entries.</td></tr>'; return; }
  tbody.innerHTML = log.map(function(e){
    var badgeCls = actionColors[e.action]||'badge-gray';
    var roleColor = {
      'Super Admin':'badge-purple','Moderator':'badge-blue',
      'Finance':'badge-green','Security':'badge-red','Compliance':'badge-yellow'
    }[e.role]||'badge-gray';
    return '<tr>'+
      '<td style="font-family:monospace;color:#64748b;font-size:10px;white-space:nowrap;">'+new Date(e.ts).toLocaleString()+'</td>'+
      '<td><code style="font-size:10px;color:#93c5fd;">'+esc(short(e.admin,8,4))+'</code></td>'+
      '<td><span class="badge '+roleColor+'">'+esc(e.role)+'</span></td>'+
      '<td><span class="badge '+badgeCls+'">'+esc(e.action)+'</span></td>'+
      '<td><code style="font-size:10px;">'+esc(short(e.target,8,4))+'</code></td>'+
      '<td style="font-size:11px;color:#94a3b8;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc(e.detail||'\u2014')+'</td>'+
      '<td><span class="badge badge-blue" style="font-size:9px;">'+esc(e.chain||'Arc')+'</span></td>'+
    '</tr>';
  }).join('');
}

function filterAudit(q){
  q = (q||'').toLowerCase();
  var filtered = q ? _allAudit.filter(function(e){
    return (e.action+e.target+e.detail+e.admin+e.role).toLowerCase().includes(q);
  }) : _allAudit;
  renderAudit(filtered);
}

function exportAuditLog(){
  var log = getAudit();
  var nl = String.fromCharCode(10);
  var csv = 'Timestamp,Admin,Role,Action,Target,Detail,Chain'+nl+
    log.map(function(e){ return [e.ts,e.admin,e.role,e.action,e.target,e.detail,e.chain].map(function(v){ return '"'+(v||'').replace(/"/g,'""')+'"'; }).join(','); }).join(nl);
  var blob = new Blob([csv],{type:'text/csv'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href=url; a.download='shukly-admin-audit-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('Audit log exported','success');
}

// \u2500\u2500 Access Control \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadAccess(){
  var list = [];
  try { list = JSON.parse(localStorage.getItem(KEYS.WHITELIST)||'[]'); } catch(e){}
  if(!list.length) list = generateMockAccess();
  var tbody = document.getElementById('access-tbody');
  if(!tbody) return;
  tbody.innerHTML = list.map(function(a){
    var roleColors = {
      'Super Admin':'badge-purple','Moderator':'badge-blue',
      'Finance':'badge-green','Security':'badge-red','Compliance':'badge-yellow','Read Only':'badge-gray'
    };
    var rc = roleColors[a.role]||'badge-gray';
    return '<tr>'+
      '<td><code style="font-size:11px;color:#93c5fd;">'+esc(a.address||a.wallet)+'</code></td>'+
      '<td><span class="badge '+rc+'">'+esc(a.role)+'</span></td>'+
      '<td style="font-size:11px;color:#64748b;max-width:180px;">'+esc((a.permissions||'Full access').slice(0,40))+'</td>'+
      '<td style="color:#64748b;font-size:11px;">'+new Date(a.lastLogin||a.added||Date.now()).toLocaleDateString()+'</td>'+
      '<td><code style="font-size:10px;">'+esc(short(a.addedBy,8,4)||'\u2014')+'</code></td>'+
      '<td><span class="badge badge-green">Active</span></td>'+
      '<td>'+
        '<button class="btn btn-danger" style="padding:4px 8px;font-size:10px;" onclick="removeAdmin(&#39;'+esc(a.address||a.wallet)+'&#39;)"><i class="fas fa-user-minus"></i></button>'+
      '</td>'+
    '</tr>';
  }).join('');
}

function generateMockAccess(){
  var roles = ['Super Admin','Moderator','Finance','Security','Compliance'];
  var perms = ['Full access','Moderation only','Financial reports only','Security monitoring','Compliance reports'];
  return Array.from({length:5},function(_,i){
    return {
      address:'0x'+Math.random().toString(16).slice(2,42),
      role:roles[i],
      permissions:perms[i],
      lastLogin:new Date(Date.now()-Math.random()*7*864e5).toISOString(),
      addedBy:'0x'+Math.random().toString(16).slice(2,42)
    };
  });
}

function removeAdmin(addr){
  if(!confirm('Remove admin access for: '+addr+'?')) return;
  addAudit('admin_remove', addr, 'Admin access revoked');
  loadAccess();
  showToast('Admin access removed','warning');
}

function openAddAdminModal(){
  showModal(
    '<div style="display:grid;gap:14px;">'+
    '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Wallet Address *</label>'+
    '<input id="new-admin-addr" class="input" placeholder="0x\u2026" style="font-family:monospace;font-size:12px;"/></div>'+
    '<div><label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:5px;">Role</label>'+
    '<select id="new-admin-role" class="select" style="font-size:12px;"><option>Moderator</option><option>Finance</option><option>Security</option><option>Compliance</option><option>Read Only</option><option>Super Admin</option></select></div>'+
    '</div>',
    'Add Admin Account',
    function(){
      var addr=(document.getElementById('new-admin-addr')||{}).value||'';
      var role=(document.getElementById('new-admin-role')||{}).value||'Moderator';
      if(!addr||!addr.startsWith('0x')||addr.length<10){ showToast('Invalid address','error'); return; }
      var list=[]; try{ list=JSON.parse(localStorage.getItem(KEYS.WHITELIST)||'[]'); }catch(e){}
      list.push({ address:addr.toLowerCase(), role, permissions:role+' permissions', addedBy:getMyWallet()||'admin', added:new Date().toISOString() });
      localStorage.setItem(KEYS.WHITELIST,JSON.stringify(list));
      addAudit('admin_add', addr, 'Role: '+role);
      closeModal(); loadAccess();
      showToast('Admin added: '+role,'success');
    }
  );
}

// \u2500\u2500 Wallet lookup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function lookupWallet(){
  var addr = (document.getElementById('wallet-lookup-input')||{}).value||'';
  if(!addr||!addr.startsWith('0x')) { showToast('Enter a valid 0x\u2026 address','error'); return; }
  var res = document.getElementById('wallet-lookup-result');
  if(res){ res.style.display='block'; res.innerHTML='<div style="font-size:11px;color:#64748b;padding:8px 0;">Looking up\u2026</div>'; }
  try {
    var r = await fetch('/api/arc/balance/'+encodeURIComponent(addr), { signal: AbortSignal.timeout(10000) });
    var d = await r.json();
    if(res) res.innerHTML =
      '<div style="font-size:11px;display:flex;flex-direction:column;gap:6px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:9px;padding:10px;">'+
      '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Balance</span><span style="color:#4ade80;font-weight:600;">'+esc(d.balance)+' ARC</span></div>'+
      '<div style="display:flex;justify-content:space-between;"><span style="color:#64748b;">Tx Count</span><span style="color:#e2e8f0;">'+esc(String(d.txCount))+'</span></div>'+
      '<a href="'+ARC_CONFIG.explorer+'/address/'+esc(addr)+'" target="_blank" style="color:#60a5fa;font-size:10px;text-align:center;">View on Arc Explorer \u2192</a>'+
      '</div>';
  } catch(e){
    if(res) res.innerHTML='<div style="font-size:11px;color:#f87171;padding:8px 0;">Lookup failed \u2014 RPC error</div>';
  }
}

// \u2500\u2500 Feed controls \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function toggleFeedPause(){
  _feedPaused = !_feedPaused;
  var btn = document.getElementById('feed-pause-btn');
  if(btn) btn.innerHTML = _feedPaused
    ? '<i class="fas fa-play"></i>Resume'
    : '<i class="fas fa-pause"></i>Pause';
}

function switchFeedFilter(f, btn){
  _feedFilter = f;
  document.querySelectorAll('[onclick^="switchFeedFilter"]').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  renderLiveFeedTable();
}

function initLiveFeed(){ fetchTxFeed(); fetchEscrowEvents(); }

// \u2500\u2500 Refresh functions \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function refreshDashboard(){
  fetchArcStats();
  fetchTxFeed();
  fetchEscrowEvents();
  showToast('Dashboard refreshed','success');
}

// \u2500\u2500 Modal helper \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function showModal(body, title, onConfirm){
  var root = document.getElementById('modal-root');
  var hasConfirm = typeof onConfirm === 'function';
  root.innerHTML = '<div class="modal-overlay" id="main-overlay">'+
    '<div class="modal">'+
    '<div class="modal-hd"><p style="font-weight:700;font-size:15px;color:#e2e8f0;">'+esc(title||'')+'</p>'+
    '<button onclick="closeModal()" style="background:rgba(255,255,255,0.06);border:none;color:#94a3b8;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:16px;">&times;</button></div>'+
    '<div class="modal-bd">'+body+'</div>'+
    (hasConfirm?'<div class="modal-ft"><button onclick="closeModal()" class="btn btn-ghost">Cancel</button><button onclick="window._modalConfirm()" class="btn btn-primary">Confirm</button></div>':'')+
    '</div></div>';
  if(hasConfirm) window._modalConfirm = onConfirm;
  document.getElementById('main-overlay').addEventListener('click',function(e){ if(e.target===this) closeModal(); });
}

function closeModal(){ document.getElementById('modal-root').innerHTML=''; }

// \u2500\u2500 Global search \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function handleGlobalSearch(q){
  if(q.startsWith('0x')&&q.length>10){
    // Wallet search
  }
}

// \u2500\u2500 KPI data loading \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function loadKPIs(){
  var orders = getOrders();
  var kpiO = document.getElementById('kpi-orders'); if(kpiO) kpiO.textContent = orders.length||Math.floor(Math.random()*50+20);
  var vol = orders.reduce(function(s,o){ return s+(parseFloat(o.amount)||0); }, 0);
  var kpiV = document.getElementById('kpi-volume'); if(kpiV) kpiV.textContent = '$'+(vol||Math.floor(Math.random()*5000+1000)).toLocaleString();
  var kpiS = document.getElementById('kpi-sellers'); if(kpiS) kpiS.textContent = Math.floor(Math.random()*30+15);
}

// \u2500\u2500 Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
document.addEventListener('DOMContentLoaded',function(){
  // Check auth
  var w = null;
  try { w = JSON.parse(localStorage.getItem('rh_wallet')||'{}'); } catch(e){}
  var addr = w && w.address ? w.address : null;
  var dynamicList = []; try{ dynamicList=JSON.parse(localStorage.getItem(KEYS.WHITELIST)||'[]'); }catch(e){}
  var allAdmins = dynamicList.map(function(a){return (a.address||a).toLowerCase();});

  var sbAddr = document.getElementById('sb-wallet-addr');
  if(addr){ if(sbAddr) sbAddr.textContent=addr.slice(0,10)+'\u2026'+addr.slice(-6); }
  else { if(sbAddr) sbAddr.textContent='Not connected'; }

  // First visit: allow self-setup if whitelist is empty
  if(!addr && dynamicList.length===0){
    showToast('Connect your wallet at Shukly Store first, then return','info');
  } else if(addr && dynamicList.length===0){
    // Auto-grant first admin
    dynamicList.push({ address:addr.toLowerCase(), role:'Super Admin', permissions:'Full access', addedBy:'genesis', added:new Date().toISOString() });
    localStorage.setItem(KEYS.WHITELIST,JSON.stringify(dynamicList));
    addAudit('admin_login', addr, 'First admin \u2014 auto-granted Super Admin');
    showToast('Welcome, Super Admin! You have been granted full access.','success');
    document.getElementById('nav-alert-badge').style.display='';
  } else if(addr && allAdmins.includes(addr.toLowerCase())){
    var myEntry = dynamicList.find(function(a){ return (a.address||a).toLowerCase()===addr.toLowerCase(); });
    var myRole = myEntry ? (myEntry.role||'Admin') : 'Admin';
    var sbRole = document.getElementById('sb-role-name'); if(sbRole) sbRole.textContent=myRole;
    localStorage.setItem('adm_my_role', myRole);
    addAudit('admin_login', addr, 'Panel access');
    showToast('Welcome back, '+myRole+'!','success');
  }

  // Start Arc polling
  fetchArcStats();
  loadKPIs();
  initDashboardCharts();
  fetchTxFeed();
  fetchEscrowEvents();

  _arcInterval = setInterval(fetchArcStats, 10000);
  _feedInterval = setInterval(fetchTxFeed, 15000);

  // Clock
  setInterval(function(){
    var t=document.getElementById('sb-time'); if(t) t.textContent=new Date().toLocaleTimeString();
  }, 1000);
});
<\/script>
`;
}
__name(rs, "rs");
__name2(rs, "rs");
function ns() {
  return [{ icon: "fa-exclamation-triangle", color: "#f87171", bg: "rgba(239,68,68,0.1)", label: "Fraud Alert", msg: "Wallet 0x9f3a\u2026 suspicious pattern", time: "2m ago", sev: "critical" }, { icon: "fa-gavel", color: "#fbbf24", bg: "rgba(234,179,8,0.1)", label: "Dispute Opened", msg: "Order ORD-1776\u2026 \u2014 $450 USDC at risk", time: "15m ago", sev: "high" }, { icon: "fa-ban", color: "#fb923c", bg: "rgba(249,115,22,0.1)", label: "Seller Suspended", msg: "0xb7c2\u2026 auto-flagged (3 disputes)", time: "1h ago", sev: "high" }, { icon: "fa-lock", color: "#60a5fa", bg: "rgba(59,130,246,0.1)", label: "Escrow Event", msg: "EscrowFunded: $200 USDC locked", time: "2h ago", sev: "info" }].map((e) => `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px;border-radius:9px;background:${e.bg};border:1px solid ${e.color}22;">
      <div style="width:28px;height:28px;border-radius:7px;background:${e.bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fas ${e.icon}" style="color:${e.color};font-size:11px;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <p style="font-size:11px;font-weight:700;color:#e2e8f0;">${e.label}</p>
        <p style="font-size:10px;color:#94a3b8;margin-top:1px;">${e.msg}</p>
      </div>
      <span style="font-size:10px;color:#475569;white-space:nowrap;flex-shrink:0;">${e.time}</span>
    </div>`).join("");
}
__name(ns, "ns");
__name2(ns, "ns");
function ls() {
  return [{ label: "Fraud Score", value: 18, color: "#4ade80" }, { label: "Dispute Rate", value: 12, color: "#4ade80" }, { label: "Blacklist %", value: 3, color: "#4ade80" }, { label: "Suspended Sellers", value: 8, color: "#fbbf24" }, { label: "High-Risk Products", value: 12, color: "#fb923c" }, { label: "Critical Alerts", value: 2, color: "#f87171" }].map((e) => `<div>
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
        <span style="color:#94a3b8;">${e.label}</span>
        <span style="color:${e.color};font-weight:600;">${e.value}</span>
      </div>
      <div class="risk-bar"><div class="risk-fill" style="width:${Math.min(e.value * 5, 100)}%;background:${e.color};"></div></div>
    </div>`).join("");
}
__name(ls, "ls");
__name2(ls, "ls");
function ds() {
  return [{ label: "Avg Order Value", value: "$184", sub: "USDC per order", color: "#60a5fa" }, { label: "Dispute Rate", value: "7.2%", sub: "vs 5% industry avg", color: "#f87171" }, { label: "Avg Resolution Time", value: "2.4 days", sub: "Dispute to resolved", color: "#4ade80" }, { label: "Seller Retention", value: "88%", sub: "30-day active", color: "#a78bfa" }, { label: "Token Split", value: "78/22", sub: "USDC / EURC", color: "#34d399" }, { label: "Arc Gas Used", value: "1.2M", sub: "Gwei this month", color: "#fbbf24" }].map((e) => `<div class="glass-card-sm">
      <p style="font-size:11px;color:#64748b;margin-bottom:5px;">${e.label}</p>
      <p style="font-size:22px;font-weight:900;color:${e.color};">${e.value}</p>
      <p style="font-size:10px;color:#475569;margin-top:3px;">${e.sub}</p>
    </div>`).join("");
}
__name(ds, "ds");
__name2(ds, "ds");
function cs() {
  return Array.from({ length: 5 }, (t, e) => {
    const s = [15, 42, 28, 71, 9][e], a = s > 70 ? "#f87171" : s > 40 ? "#fb923c" : "#4ade80", o = ["Active", "Active", "Suspended", "Active", "Active"], i = o[e] === "Active" ? "badge-green" : "badge-yellow";
    return `<tr>
      <td style="font-weight:700;color:#64748b;">${e + 1}</td>
      <td><code style="font-size:11px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 12)}\u2026</code></td>
      <td>${[42, 38, 31, 28, 21][e]}</td>
      <td style="font-weight:700;color:#4ade80;">$${[8420, 6180, 5290, 4100, 2890][e].toLocaleString()}</td>
      <td style="color:${[0, 1, 3, 0, 0][e] > 0 ? "#f87171" : "#4ade80"}">${[0, 1, 3, 0, 0][e]}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="risk-bar" style="width:50px;"><div class="risk-fill" style="width:${s}%;background:${a};"></div></div>
          <span style="font-size:11px;color:${a};font-weight:600;">${s}</span>
        </div>
      </td>
      <td><span class="badge ${i}">${o[e]}</span></td>
    </tr>`;
  }).join("");
}
__name(cs, "cs");
__name2(cs, "cs");
function ps() {
  return Array.from({ length: 6 }, () => {
    const t = Math.floor(Math.random() * 80 + 5), e = t > 70 ? "#f87171" : t > 40 ? "#fb923c" : "#4ade80", s = Math.floor(Math.random() * 4), a = ["Active", "Active", "Suspended", "Active", "Active", "Banned"], o = a[Math.floor(Math.random() * a.length)], i = { Active: "badge-green", Suspended: "badge-yellow", Banned: "badge-red" }[o] || "badge-gray";
    return `<tr>
      <td><code style="font-size:11px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 12)}\u2026</code></td>
      <td style="text-align:center;">${Math.floor(Math.random() * 15 + 1)}</td>
      <td style="text-align:center;">${Math.floor(Math.random() * 40 + 5)}</td>
      <td style="color:#4ade80;font-weight:700;">$${(Math.random() * 3e3 + 200).toFixed(0)}</td>
      <td style="text-align:center;color:${s > 2 ? "#f87171" : "#94a3b8"}">${s}</td>
      <td><div style="display:flex;align-items:center;gap:5px;"><div class="risk-bar" style="width:45px;"><div class="risk-fill" style="width:${t}%;background:${e}"></div></div><span style="font-size:10px;color:${e}">${t}</span></div></td>
      <td><span class="badge ${i}">${o}</span></td>
      <td style="color:#64748b;font-size:11px;">${new Date(Date.now() - Math.random() * 60 * 864e5).toLocaleDateString()}</td>
      <td><div style="display:flex;gap:4px;">
        <button class="btn btn-warning" style="padding:3px 7px;font-size:10px;"><i class="fas fa-user-slash"></i></button>
        <button class="btn btn-danger" style="padding:3px 7px;font-size:10px;"><i class="fas fa-ban"></i></button>
        <button class="btn btn-ghost" style="padding:3px 7px;font-size:10px;"><i class="fas fa-chart-bar"></i></button>
      </div></td>
    </tr>`;
  }).join("");
}
__name(ps, "ps");
__name2(ps, "ps");
function fs() {
  return [{ sev: "Critical", color: "#f87171", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", icon: "fa-robot", title: "AI Risk Score Alert", body: "Wallet 0x9f3a\u2026 scored 94/100. 8 orders in 2 hours, all to same seller.", actions: ["Freeze", "Investigate", "Dismiss"] }, { sev: "High", color: "#fb923c", bg: "rgba(249,115,22,0.06)", border: "rgba(249,115,22,0.2)", icon: "fa-exclamation-triangle", title: "Unusual Pattern", body: "Wallet 0x4e8b\u2026 created 3 disputes on first 3 purchases (100% dispute rate).", actions: ["Suspend", "Review", "Ignore"] }].map((e) => `<div class="glass-card" style="border-color:${e.border};">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:38px;height:38px;background:${e.bg};border-radius:10px;display:flex;align-items:center;justify-content:center;">
            <i class="fas ${e.icon}" style="color:${e.color};font-size:16px;"></i>
          </div>
          <div>
            <p style="font-weight:700;font-size:13px;color:#e2e8f0;">${e.title}</p>
            <span class="badge" style="background:${e.bg};color:${e.color};border-color:${e.border};margin-top:2px;">${e.sev}</span>
          </div>
        </div>
      </div>
      <p style="font-size:12px;color:#94a3b8;margin-bottom:14px;">${e.body}</p>
      <div style="display:flex;gap:8px;">
        ${e.actions.map((s, a) => `<button class="btn ${a === 0 ? "btn-danger" : a === 1 ? "btn-warning" : "btn-ghost"}" onclick="showToast('${s} action recorded','${a === 0 ? "error" : a === 1 ? "warning" : "info"}')">${s}</button>`).join("")}
      </div>
    </div>`).join("");
}
__name(fs, "fs");
__name2(fs, "fs");
function gs() {
  return Array.from({ length: 8 }, () => {
    const t = Math.floor(Math.random() * 100), e = t > 70 ? "risk-high" : t > 40 ? "risk-med" : "risk-low", s = [["High velocity", "Multiple IPs"], ["Dispute history"], ["New account"], ["Normal"], ["Normal"], ["High velocity"], ["Suspicious timing"], ["Normal"]], a = s[Math.floor(Math.random() * s.length)];
    return `<tr>
      <td><code style="font-size:10px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 12)}\u2026</code></td>
      <td>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="risk-bar" style="width:70px;"><div class="risk-fill" style="width:${t}%;background:${t > 70 ? "#f87171" : t > 40 ? "#fb923c" : "#4ade80"};"></div></div>
          <span class="count-up ${e}" style="font-weight:700;font-size:12px;">${t}</span>
        </div>
      </td>
      <td>${a.map((o) => `<span class="badge badge-gray" style="font-size:9px;margin-right:3px;">${o}</span>`).join("")}</td>
      <td style="text-align:center;">${Math.floor(Math.random() * 20 + 1)}</td>
      <td style="text-align:center;color:${Math.floor(Math.random() * 3) > 1 ? "#f87171" : "#4ade80"}">${Math.floor(Math.random() * 3)}</td>
      <td style="color:#64748b;font-size:11px;">${Math.floor(Math.random() * 24 + 1)}h ago</td>
      <td><div style="display:flex;gap:4px;">
        <button class="btn btn-warning" style="padding:4px 8px;font-size:10px;" onclick="showToast('Flagging for review','warning')"><i class="fas fa-flag"></i></button>
        <button class="btn btn-danger" style="padding:4px 8px;font-size:10px;" onclick="showToast('Wallet suspended','error')"><i class="fas fa-ban"></i></button>
      </div></td>
    </tr>`;
  }).join("");
}
__name(gs, "gs");
__name2(gs, "gs");
function us() {
  return Array.from({ length: 5 }, () => {
    const t = Math.random() > 0.6, e = Math.floor(Math.random() * 10 + 1);
    return `<tr>
      <td><code style="font-size:10px;color:#93c5fd;">ORD-${Math.floor(Math.random() * 9e6 + 1e6)}-${Math.random().toString(36).slice(2, 5)}</code></td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td style="font-weight:700;color:#4ade80;">$${(Math.random() * 500 + 50).toFixed(2)} <span style="color:#64748b;font-size:10px;">USDC</span></td>
      <td>${t ? '<span class="badge badge-green">Resolved</span>' : '<span class="badge badge-red"><i class="fas fa-fire" style="font-size:9px;"></i> Open</span>'}</td>
      <td style="text-align:center;color:#64748b;">${Math.floor(Math.random() * 3)}</td>
      <td style="color:${e > 5 ? "#f87171" : "#94a3b8"}">${e}d</td>
      <td>${t ? '<span style="color:#475569;font-size:11px;">\u2014</span>' : `<div style="display:flex;gap:4px;">
          <button class="btn btn-ghost" style="padding:4px 8px;font-size:10px;" onclick="showToast('Viewing evidence','info')"><i class="fas fa-eye"></i></button>
          <button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="showToast('Refund initiated','success')"><i class="fas fa-undo"></i>Refund</button>
          <button class="btn btn-primary" style="padding:4px 8px;font-size:10px;" onclick="showToast('Funds released','success')"><i class="fas fa-coins"></i>Release</button>
        </div>`}</td>
    </tr>`;
  }).join("");
}
__name(us, "us");
__name2(us, "us");
function bs() {
  const t = ["EscrowFunded", "FundsReleased", "Refund", "EscrowFunded", "FundsReleased"], e = { EscrowFunded: "badge-blue", FundsReleased: "badge-green", Refund: "badge-yellow" };
  return t.map((s) => `<tr>
      <td><a href="#" style="color:#60a5fa;font-size:10px;">0x${Math.random().toString(16).slice(2, 12)}\u2026</a></td>
      <td><span class="badge ${e[s] || "badge-gray"}">${s}</span></td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td style="font-weight:700;color:#4ade80;">$${(Math.random() * 400 + 50).toFixed(2)}</td>
      <td style="color:#64748b;font-size:11px;">${new Date(Date.now() - Math.random() * 7 * 864e5).toLocaleDateString()}</td>
      <td><span class="badge badge-green">Confirmed</span></td>
    </tr>`).join("");
}
__name(bs, "bs");
__name2(bs, "bs");
function hs() {
  return [{ icon: "fa-sign-in-alt", color: "#60a5fa", label: "Admin Login", detail: "Super Admin \u2014 0x1a2b\u2026 logged in", time: "5m ago" }, { icon: "fa-exclamation-triangle", color: "#f87171", label: "Unauthorized Access Attempt", detail: "0x9f3a\u2026 tried to access /admin", time: "2h ago" }, { icon: "fa-ban", color: "#fb923c", label: "Wallet Blacklisted", detail: "0x4e8b\u2026 \u2014 Fraud (Critical)", time: "3h ago" }, { icon: "fa-shield-alt", color: "#4ade80", label: "Security Rule Triggered", detail: "Large transaction alert: $600 USDC", time: "5h ago" }].map((e) => `<div style="display:flex;align-items:flex-start;gap:10px;">
      <div style="width:28px;height:28px;background:rgba(255,255,255,0.04);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fas ${e.icon}" style="color:${e.color};font-size:11px;"></i>
      </div>
      <div style="flex:1;">
        <p style="font-size:12px;font-weight:600;color:#e2e8f0;">${e.label}</p>
        <p style="font-size:10px;color:#64748b;margin-top:1px;">${e.detail}</p>
      </div>
      <span style="font-size:10px;color:#475569;flex-shrink:0;">${e.time}</span>
    </div>`).join("");
}
__name(hs, "hs");
__name2(hs, "hs");
function xs() {
  return [{ role: "Super Admin", count: 1, color: "#c084fc", badge: "badge-purple" }, { role: "Moderator", count: 2, color: "#60a5fa", badge: "badge-blue" }, { role: "Finance", count: 1, color: "#4ade80", badge: "badge-green" }, { role: "Security", count: 1, color: "#f87171", badge: "badge-red" }, { role: "Read Only", count: 3, color: "#94a3b8", badge: "badge-gray" }].map((e) => `<div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${e.color};"></div>
        <span style="font-size:12px;color:#94a3b8;">${e.role}</span>
      </div>
      <span class="badge ${e.badge}">${e.count} admin${e.count > 1 ? "s" : ""}</span>
    </div>`).join("");
}
__name(xs, "xs");
__name2(xs, "xs");
function ys() {
  return [{ name: "Large Transaction Alert", desc: "Notify admin when single USDC tx > $500", enabled: true }, { name: "Auto-freeze on Dispute", desc: "Lock escrow immediately when dispute filed", enabled: true }, { name: "Velocity Check", desc: "Flag wallets with >5 orders/hour", enabled: true }, { name: "New Seller KYC Hold", desc: "Hold first listing for manual review", enabled: false }, { name: "IP Reputation Check", desc: "Cross-reference IPs against abuse database", enabled: false }].map((e) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:9px;">
      <div>
        <p style="font-size:12px;font-weight:600;color:#e2e8f0;">${e.name}</p>
        <p style="font-size:11px;color:#64748b;margin-top:2px;">${e.desc}</p>
      </div>
      <label style="position:relative;width:40px;height:22px;cursor:pointer;">
        <input type="checkbox" ${e.enabled ? "checked" : ""} style="opacity:0;width:0;height:0;" onchange="showToast('Rule '+(this.checked?'enabled':'disabled'),'info')"/>
        <span style="position:absolute;inset:0;background:${e.enabled ? "#2563eb" : "rgba(255,255,255,0.1)"};border-radius:11px;transition:.3s;"></span>
        <span style="position:absolute;left:${e.enabled ? "20px" : "2px"};top:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.3s;"></span>
      </label>
    </div>`).join("");
}
__name(ys, "ys");
__name2(ys, "ys");
function ms() {
  return [{ name: "Maintenance Mode", desc: "Show maintenance banner", enabled: false }, { name: "New Registrations", desc: "Allow new users to register", enabled: true }, { name: "Auto-Moderation", desc: "AI auto-flags suspicious products", enabled: true }, { name: "Dispute Notifications", desc: "Email alerts for new disputes", enabled: true }].map((e) => `<div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <p style="font-size:13px;font-weight:600;color:#e2e8f0;">${e.name}</p>
        <p style="font-size:11px;color:#64748b;margin-top:2px;">${e.desc}</p>
      </div>
      <label style="position:relative;width:40px;height:22px;cursor:pointer;flex-shrink:0;">
        <input type="checkbox" ${e.enabled ? "checked" : ""} style="opacity:0;width:0;height:0;" onchange="showToast('Setting updated','success')"/>
        <span style="position:absolute;inset:0;background:${e.enabled ? "#2563eb" : "rgba(255,255,255,0.1)"};border-radius:11px;transition:.3s;"></span>
        <span style="position:absolute;left:${e.enabled ? "20px" : "2px"};top:2px;width:18px;height:18px;background:#fff;border-radius:50%;transition:.3s;"></span>
      </label>
    </div>`).join("");
}
__name(ms, "ms");
__name2(ms, "ms");
function vs() {
  return [{ name: "Super Admin", color: "#a78bfa", bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.25)", icon: "fa-crown", perms: "Full platform access" }, { name: "Moderator", color: "#60a5fa", bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.2)", icon: "fa-gavel", perms: "Products, Sellers, Disputes" }, { name: "Finance", color: "#4ade80", bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.2)", icon: "fa-university", perms: "Treasury, Analytics" }, { name: "Security", color: "#f87171", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)", icon: "fa-shield-virus", perms: "Security, Blacklist, Fraud" }, { name: "Compliance", color: "#fbbf24", bg: "rgba(234,179,8,0.1)", border: "rgba(234,179,8,0.2)", icon: "fa-balance-scale", perms: "Audit Log, Reports" }, { name: "Read Only", color: "#94a3b8", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.15)", icon: "fa-eye", perms: "View only \u2014 no actions" }].map((e) => `<div class="glass-card-sm" style="border-color:${e.border};">
      <div style="width:36px;height:36px;background:${e.bg};border-radius:9px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">
        <i class="fas ${e.icon}" style="color:${e.color};font-size:14px;"></i>
      </div>
      <p style="font-size:12px;font-weight:700;color:#e2e8f0;">${e.name}</p>
      <p style="font-size:10px;color:#64748b;margin-top:3px;">${e.perms}</p>
    </div>`).join("");
}
__name(vs, "vs");
__name2(vs, "vs");
function ws() {
  const t = ["Fraud / Scam", "Fake Products", "Policy Violation", "Money Laundering", "Harassment"], e = ["critical", "high", "medium"];
  return Array.from({ length: 4 }, () => {
    const s = e[Math.floor(Math.random() * e.length)], a = { critical: "badge-red", high: "badge-orange", medium: "badge-yellow" }[s] || "badge-gray";
    return `<tr>
      <td><code style="font-size:11px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 42)}</code></td>
      <td><span class="badge badge-blue">${Math.random() > 0.5 ? "seller" : "buyer"}</span></td>
      <td style="font-size:11px;color:#94a3b8;">${t[Math.floor(Math.random() * t.length)]}</td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td style="color:#64748b;font-size:11px;">${new Date(Date.now() - Math.random() * 30 * 864e5).toLocaleDateString()}</td>
      <td><span class="badge ${a}">${s}</span></td>
      <td>
        <button class="btn btn-success" style="padding:4px 8px;font-size:10px;" onclick="showToast('Wallet removed from blacklist','success')"><i class="fas fa-unlock"></i></button>
      </td>
    </tr>`;
  }).join("");
}
__name(ws, "ws");
__name2(ws, "ws");
function ks() {
  const t = ["product_pause", "seller_suspend", "dispute_resolve", "wallet_blacklist", "admin_login", "product_remove", "user_ban", "seller_ban"], e = ["Super Admin", "Moderator", "Finance", "Security", "Compliance"], s = { "Super Admin": "badge-purple", Moderator: "badge-blue", Finance: "badge-green", Security: "badge-red", Compliance: "badge-yellow" }, a = { product_pause: "badge-yellow", product_remove: "badge-red", seller_suspend: "badge-orange", seller_ban: "badge-red", user_ban: "badge-red", dispute_resolve: "badge-green", wallet_blacklist: "badge-red", admin_login: "badge-blue" };
  return Array.from({ length: 12 }, () => {
    const o = t[Math.floor(Math.random() * t.length)], i = e[Math.floor(Math.random() * e.length)];
    return `<tr>
      <td style="font-family:monospace;color:#64748b;font-size:10px;white-space:nowrap;">${new Date(Date.now() - Math.random() * 7 * 864e5).toLocaleString()}</td>
      <td><code style="font-size:10px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td><span class="badge ${s[i] || "badge-gray"}">${i}</span></td>
      <td><span class="badge ${a[o] || "badge-gray"}">${o}</span></td>
      <td><code style="font-size:10px;">0x${Math.random().toString(16).slice(2, 10)}\u2026</code></td>
      <td style="font-size:11px;color:#94a3b8;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Policy violation \u2014 reviewed and confirmed</td>
      <td><span class="badge badge-blue" style="font-size:9px;">Arc Testnet</span></td>
    </tr>`;
  }).join("");
}
__name(ks, "ks");
__name2(ks, "ks");
function Ss() {
  const t = ["Super Admin", "Moderator", "Finance", "Security", "Compliance", "Read Only"], e = { "Super Admin": "badge-purple", Moderator: "badge-blue", Finance: "badge-green", Security: "badge-red", Compliance: "badge-yellow", "Read Only": "badge-gray" }, s = { "Super Admin": "Full access", Moderator: "Products, Sellers, Disputes", Finance: "Treasury, Analytics", Security: "Security, Blacklist", Compliance: "Audit, Reports", "Read Only": "View only" };
  return t.map((a) => `<tr>
      <td><code style="font-size:11px;color:#93c5fd;">0x${Math.random().toString(16).slice(2, 12)}\u2026</code></td>
      <td><span class="badge ${e[a] || "badge-gray"}">${a}</span></td>
      <td style="font-size:11px;color:#64748b;">${s[a] || "Custom"}</td>
      <td style="color:#64748b;font-size:11px;">${new Date(Date.now() - Math.random() * 3 * 864e5).toLocaleDateString()}</td>
      <td><code style="font-size:10px;">genesis</code></td>
      <td><span class="badge badge-green">Active</span></td>
      <td><button class="btn btn-danger" style="padding:4px 8px;font-size:10px;" onclick="showToast('Admin access revoked','warning')"><i class="fas fa-user-minus"></i></button></td>
    </tr>`).join("");
}
__name(Ss, "Ss");
__name2(Ss, "Ss");
E.get("/", (t) => t.html(rs("Dashboard")));
E.get("/dashboard", (t) => t.redirect("/"));
E.get("/products", (t) => t.redirect("/"));
E.get("/disputes", (t) => t.redirect("/"));
E.get("/escrow", (t) => t.redirect("/"));
E.get("/treasury", (t) => t.redirect("/"));
E.get("/security", (t) => t.redirect("/"));
E.get("/audit", (t) => t.redirect("/"));
E.get("/settings", (t) => t.redirect("/"));
var Xe = new mt();
var As = Object.assign({ "/src/index.tsx": E });
var vt = false;
for (const [, t] of Object.entries(As))
  t && (Xe.route("/", t), Xe.notFound(t.notFoundHandler), vt = true);
if (!vt)
  throw new Error("Can't import modules from ['/src/index.tsx','/app/server.ts']");
var drainBody = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
__name2(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name2(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = Xe;
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
__name2(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
__name2(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");
__name2(__facade_invoke__, "__facade_invoke__");
var __Facade_ScheduledController__ = /* @__PURE__ */ __name(class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
}, "__Facade_ScheduledController__");
__name2(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name2(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name2(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
__name2(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
__name2(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;

// node_modules/wrangler/templates/pages-dev-util.ts
function isRoutingRuleMatch(pathname, routingRule) {
  if (!pathname) {
    throw new Error("Pathname is undefined.");
  }
  if (!routingRule) {
    throw new Error("Routing rule is undefined.");
  }
  const ruleRegExp = transformRoutingRuleToRegExp(routingRule);
  return pathname.match(ruleRegExp) !== null;
}
__name(isRoutingRuleMatch, "isRoutingRuleMatch");
function transformRoutingRuleToRegExp(rule) {
  let transformedRule;
  if (rule === "/" || rule === "/*") {
    transformedRule = rule;
  } else if (rule.endsWith("/*")) {
    transformedRule = `${rule.substring(0, rule.length - 2)}(/*)?`;
  } else if (rule.endsWith("/")) {
    transformedRule = `${rule.substring(0, rule.length - 1)}(/)?`;
  } else if (rule.endsWith("*")) {
    transformedRule = rule;
  } else {
    transformedRule = `${rule}(/)?`;
  }
  transformedRule = `^${transformedRule.replaceAll(/\./g, "\\.").replaceAll(/\*/g, ".*")}$`;
  return new RegExp(transformedRule);
}
__name(transformRoutingRuleToRegExp, "transformRoutingRuleToRegExp");

// .wrangler/tmp/pages-VZJxGp/94qtydkb50f.js
var define_ROUTES_default = { version: 1, include: ["/*"], exclude: ["/_headers", "/images/*", "/og-image.jpg", "/static/*"] };
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
        const workerAsHandler = middleware_loader_entry_default;
        if (workerAsHandler.fetch === void 0) {
          throw new TypeError("Entry point missing `fetch` handler");
        }
        return workerAsHandler.fetch(request, env, context);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default2 = drainBody2;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError2(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError2(e.cause)
  };
}
__name(reduceError2, "reduceError");
var jsonError2 = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError2(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default2 = jsonError2;

// .wrangler/tmp/bundle-HkeM7j/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__2 = [
  middleware_ensure_req_body_drained_default2,
  middleware_miniflare3_json_error_default2
];
var middleware_insertion_facade_default2 = pages_dev_pipeline_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__2 = [];
function __facade_register__2(...args) {
  __facade_middleware__2.push(...args.flat());
}
__name(__facade_register__2, "__facade_register__");
function __facade_invokeChain__2(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__2(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__2, "__facade_invokeChain__");
function __facade_invoke__2(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__2(request, env, ctx, dispatch, [
    ...__facade_middleware__2,
    finalMiddleware
  ]);
}
__name(__facade_invoke__2, "__facade_invoke__");

// .wrangler/tmp/bundle-HkeM7j/middleware-loader.entry.ts
var __Facade_ScheduledController__2 = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__2)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__2, "__Facade_ScheduledController__");
function wrapExportedHandler2(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__2(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__2(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler2, "wrapExportedHandler");
function wrapWorkerEntrypoint2(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__2 === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__2.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__2) {
    __facade_register__2(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__2(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__2(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint2, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY2;
if (typeof middleware_insertion_facade_default2 === "object") {
  WRAPPED_ENTRY2 = wrapExportedHandler2(middleware_insertion_facade_default2);
} else if (typeof middleware_insertion_facade_default2 === "function") {
  WRAPPED_ENTRY2 = wrapWorkerEntrypoint2(middleware_insertion_facade_default2);
}
var middleware_loader_entry_default2 = WRAPPED_ENTRY2;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__2 as __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default2 as default
};
//# sourceMappingURL=94qtydkb50f.js.map
