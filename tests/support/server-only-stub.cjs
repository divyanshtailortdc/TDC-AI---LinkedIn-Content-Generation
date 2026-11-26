// Preloaded by `pnpm test` (package.json) so server modules load in a plain
// test run: `server-only` throws outside the react-server condition, and
// running every test under that condition breaks React rendering tests.
const Module = require('module')
const path = require('path')

const empty = path.join(__dirname, 'empty.cjs')
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request === 'server-only') return empty
  return resolve.call(this, request, ...rest)
}
