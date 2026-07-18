// js/rules.mjs
// ESM loader for arena-rules WASM. Works in Node.js and browsers.
// In browser, ensure wasm_exec.js has been loaded (e.g. via <script>) before calling loadRules.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ERR_PREFIX = '__ERR__:';

function isNode() {
  return typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.node != null;
}

async function ensureGoRuntime() {
  if (typeof globalThis.Go !== 'undefined') {
    return;
  }
  if (isNode()) {
    // Load the Go WASM exec shim as CJS to populate globalThis.Go
    const require = createRequire(import.meta.url);
    // Resolve relative to this module (js/rules.mjs -> ../wasm/wasm_exec.js)
    const execPath = path.resolve(__dirname, '../wasm/wasm_exec.js');
    require(execPath);
  } else {
    throw new Error('globalThis.Go is not defined. Load wasm/wasm_exec.js via script tag before loadRules() in the browser.');
  }
  if (typeof globalThis.Go === 'undefined') {
    throw new Error('Failed to initialize Go WASM runtime (globalThis.Go missing after loading wasm_exec.js).');
  }
}

function resolveWasmPath(wasmPath) {
  if (!wasmPath) {
    throw new Error('wasmPath is required');
  }
  if (isNode()) {
    if (path.isAbsolute(wasmPath) || wasmPath.startsWith('file:')) {
      return wasmPath;
    }
    // Resolve relative to current working directory for node usage convenience
    return path.resolve(process.cwd(), wasmPath);
  }
  // Browser: return as-is (URL or relative fetch path)
  return wasmPath;
}

async function loadWasmBytes(wasmPath) {
  const resolved = resolveWasmPath(wasmPath);
  if (isNode()) {
    return await readFile(resolved);
  }
  // Browser
  const resp = await fetch(resolved);
  if (!resp.ok) {
    throw new Error(`Failed to fetch WASM: ${resp.status} ${resp.statusText}`);
  }
  return await resp.arrayBuffer();
}

export async function loadRules(wasmPath = './wasm/rules.wasm') {
  await ensureGoRuntime();

  const go = new globalThis.Go();
  const bytes = await loadWasmBytes(wasmPath);
  const result = await WebAssembly.instantiate(bytes, go.importObject);
  // Fire-and-forget: go.run returns a promise that resolves on Go exit.
  // We do not await it because the Go program runs an infinite select{} to stay alive.
  go.run(result.instance);

  // Wait briefly for the Go main() to execute its registrations (sets arenaRules).
  // The sets happen synchronously before select{}.
  const start = Date.now();
  while (typeof globalThis.arenaRules === 'undefined' && Date.now() - start < 2000) {
    await new Promise((r) => setTimeout(r, 0));
  }
  const ar = globalThis.arenaRules;
  if (!ar) {
    throw new Error('WASM module did not expose globalThis.arenaRules');
  }

  function checkErr(maybeErrStr) {
    if (typeof maybeErrStr === 'string' && maybeErrStr.startsWith(ERR_PREFIX)) {
      throw new Error(maybeErrStr.slice(ERR_PREFIX.length));
    }
    return maybeErrStr;
  }

  return {
    /**
     * init(gameId, seed?) -> state object
     */
    init(gameId, seed = '') {
      const out = ar.init(String(gameId), seed == null ? '' : String(seed));
      const json = checkErr(out);
      return JSON.parse(json);
    },

    /**
     * toMove(gameId, state) -> seat string ('' if terminal)
     */
    toMove(gameId, state) {
      const stateJSON = JSON.stringify(state);
      const out = ar.toMove(String(gameId), stateJSON);
      return checkErr(out);
    },

    /**
     * validate(gameId, state, move, seat) -> {ok: boolean, reason: string}
     */
    validate(gameId, state, move, seat) {
      const stateJSON = JSON.stringify(state);
      const moveJSON = JSON.stringify(move);
      const out = ar.validate(String(gameId), stateJSON, moveJSON, String(seat || ''));
      const json = checkErr(out);
      return JSON.parse(json);
    },

    /**
     * apply(gameId, state, move) -> next state object
     */
    apply(gameId, state, move) {
      const stateJSON = JSON.stringify(state);
      const moveJSON = JSON.stringify(move);
      const out = ar.apply(String(gameId), stateJSON, moveJSON);
      const json = checkErr(out);
      return JSON.parse(json);
    },

    /**
     * legalMoves(gameId, state) -> array of move objects
     */
    legalMoves(gameId, state) {
      const stateJSON = JSON.stringify(state);
      const out = ar.legalMoves(String(gameId), stateJSON);
      const json = checkErr(out);
      return JSON.parse(json);
    },

    /**
     * terminal(gameId, state) -> GameResult | null
     */
    terminal(gameId, state) {
      const stateJSON = JSON.stringify(state);
      const out = ar.terminal(String(gameId), stateJSON);
      const val = checkErr(out);
      if (val === 'null' || val == null) {
        return null;
      }
      return JSON.parse(val);
    },
  };
}
