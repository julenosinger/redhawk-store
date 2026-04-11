// build-vercel.mjs
// Bundles the full Hono + Vercel handler into api/index.js (ESM)
// so Vercel Node runtime can execute it without TypeScript compilation issues.

import { build } from 'esbuild'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

console.log('Building Hono app for Vercel (Node.js ESM)...')

// Write a temporary ESM entry that wraps the Hono app for Vercel
const entryContent = `
import { handle } from '@hono/node-server/vercel'
import { Hono } from 'hono'
import honoApp from '../src/index.tsx'

// Inject process.env into c.env (bridges Cloudflare Bindings → Node.js env vars)
const wrapped = new Hono()
wrapped.use('*', async (c, next) => {
  c.env = {
    CIRCLE_API_KEY: process.env.CIRCLE_API_KEY ?? '',
  }
  return next()
})
wrapped.route('/', honoApp)

const handler = handle(wrapped)
export default handler
`

mkdirSync('api', { recursive: true })
writeFileSync('api/_entry.tsx', entryContent)

// Build everything into a single self-contained ESM bundle
await build({
  entryPoints: ['api/_entry.tsx'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'api/index.js',
  // @hono/node-server must remain external (Vercel installs it at runtime)
  external: ['@hono/node-server', '@hono/node-server/vercel'],
  define: {
    // Stub Cloudflare-only globals so Node.js doesn't throw
    'D1Database': 'undefined',
    'KVNamespace': 'undefined',
  },
  banner: {
    js: `
// Node.js shims for Cloudflare Workers globals
if (typeof globalThis.caches === 'undefined') {
  globalThis.caches = { default: { match: () => undefined, put: () => undefined } }
}
`
  },
  logLevel: 'info',
})

// Clean up temp entry
import { unlinkSync } from 'fs'
try { unlinkSync('api/_entry.tsx') } catch {}
try { unlinkSync('api/_app.cjs') } catch {}

console.log('✓ Built api/index.js (Node.js ESM bundle)')
console.log('Vercel build complete.')
