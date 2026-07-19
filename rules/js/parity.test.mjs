// js/parity.test.mjs
// Node test: proves WASM rules produce identical behavior to the golden vectors
// (and thus to native Go + TS implementations).
// Run with: node js/parity.test.mjs  (from the rules/ directory)

import { loadRules } from './rules.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// parity runner is invoked from rules/ (cwd); also resolve paths relative to rules/
const RULES_ROOT = path.resolve(__dirname, '..');

const WASM_PATH = './wasm/rules.wasm';

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// Discover games/<game>/testdata/*.golden.json relative to rules/.
async function discoverGoldenFiles() {
  const gamesDir = path.join(RULES_ROOT, 'games');
  const out = [];
  let gameDirs;
  try {
    gameDirs = await fs.readdir(gamesDir, { withFileTypes: true });
  } catch (e) {
    if (e && e.code === 'ENOENT') return out;
    throw e;
  }
  for (const ent of gameDirs) {
    if (!ent.isDirectory()) continue;
    const testdataDir = path.join(gamesDir, ent.name, 'testdata');
    let files;
    try {
      files = await fs.readdir(testdataDir);
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      throw e;
    }
    for (const f of files) {
      if (!f.endsWith('.golden.json')) continue;
      // gameId from filename: tic-tac-toe.golden.json -> tic-tac-toe
      const gameId = f.slice(0, -'.golden.json'.length);
      const abs = path.join(testdataDir, f);
      const rel = path.relative(RULES_ROOT, abs);
      out.push({ gameId, abs, rel });
    }
  }
  out.sort((a, b) => a.gameId.localeCompare(b.gameId));
  return out;
}

function isUnknownGameReason(reason) {
  // wasm validate returns {ok:false, reason:"unknown game: <id>"} when game is not registered
  return typeof reason === 'string' && reason.includes('unknown game');
}

/**
 * Replay one game's golden vectors through WASM.
 * Returns {passed, total, skipped, skipReason} — skipped=true if game not in wasm.
 */
function runVectors(rules, gameId, cases, goldenRel) {
  if (cases.length === 0) {
    return { passed: 0, total: 0, skipped: false };
  }

  // Probe registration with the first vector's validate call shape.
  // If the game is unknown in the wasm build, skip the whole file.
  const probe = cases[0];
  let probeV;
  try {
    probeV = rules.validate(gameId, probe.state, probe.move, probe.seat);
  } catch (e) {
    // apply/terminal throw on unknown game; validate returns {ok, reason}
    console.error(`FAIL ${gameId}: validate threw: ${e.message}`);
    process.exit(1);
  }
  if (!probeV.ok && isUnknownGameReason(probeV.reason)) {
    return {
      passed: 0,
      total: cases.length,
      skipped: true,
      skipReason: `not present in wasm build (${goldenRel})`,
    };
  }

  let passed = 0;
  const total = cases.length;

  for (const c of cases) {
    const name = c.name;
    const state = c.state;
    const move = c.move;
    const seat = c.seat;
    const expectValid = c.expectValid;
    const expectReason = c.expectReason || '';
    const expectRes = c.expectResultAfter; // null or {kind, winner?, reason?}

    // 1. validate
    let v;
    try {
      v = rules.validate(gameId, state, move, seat);
    } catch (e) {
      console.error(`FAIL ${gameId}/${name}: validate threw: ${e.message}`);
      process.exit(1);
    }
    const valid = !!v.ok;
    const reason = v.reason || '';

    if (valid !== expectValid) {
      console.error(`FAIL ${gameId}/${name}: validate ok=${valid} want=${expectValid} (reason=${reason})`);
      process.exit(1);
    }
    if (!valid && expectReason && reason !== expectReason) {
      console.error(`FAIL ${gameId}/${name}: reason=${JSON.stringify(reason)} want=${JSON.stringify(expectReason)}`);
      process.exit(1);
    }

    if (!valid) {
      passed++;
      continue;
    }

    // 2. apply + terminal
    let after;
    try {
      after = rules.apply(gameId, state, move);
    } catch (e) {
      console.error(`FAIL ${gameId}/${name}: apply threw: ${e.message}`);
      process.exit(1);
    }

    let gotRes;
    try {
      gotRes = rules.terminal(gameId, after);
    } catch (e) {
      console.error(`FAIL ${gameId}/${name}: terminal threw: ${e.message}`);
      process.exit(1);
    }

    if (expectRes == null) {
      if (gotRes != null) {
        console.error(`FAIL ${gameId}/${name}: unexpected terminal after apply: ${JSON.stringify(gotRes)}`);
        process.exit(1);
      }
    } else {
      if (gotRes == null) {
        console.error(`FAIL ${gameId}/${name}: expected terminal result, got null`);
        process.exit(1);
      }
      if (gotRes.kind !== expectRes.kind) {
        console.error(`FAIL ${gameId}/${name}: result.kind=${gotRes.kind} want=${expectRes.kind}`);
        process.exit(1);
      }
      if (expectRes.winner != null && gotRes.winner !== expectRes.winner) {
        console.error(`FAIL ${gameId}/${name}: result.winner=${gotRes.winner} want=${expectRes.winner}`);
        process.exit(1);
      }
      if (expectRes.reason && gotRes.reason !== expectRes.reason) {
        console.error(`FAIL ${gameId}/${name}: result.reason=${gotRes.reason} want=${expectRes.reason}`);
        process.exit(1);
      }
    }

    passed++;
  }

  return { passed, total, skipped: false };
}

async function main() {
  console.log('Loading WASM rules...');
  const rules = await loadRules(WASM_PATH);

  console.log('Discovering golden vectors under games/<game>/testdata/...');
  const goldens = await discoverGoldenFiles();
  if (goldens.length === 0) {
    console.error('FAIL: no golden files found under games/*/testdata/*.golden.json');
    process.exit(1);
  }

  let passed = 0;
  let total = 0;
  let gamesRun = 0;
  const skipped = [];

  for (const { gameId, abs, rel } of goldens) {
    console.log(`Loading golden vectors for ${gameId} (${rel})...`);
    const goldenRaw = await fs.readFile(abs, 'utf8');
    const cases = JSON.parse(goldenRaw);

    const result = runVectors(rules, gameId, cases, rel);
    if (result.skipped) {
      console.log(`SKIPPED ${gameId}: ${result.skipReason}`);
      skipped.push(gameId);
      continue;
    }
    gamesRun++;
    passed += result.passed;
    total += result.total;
    console.log(`  ${gameId}: ${result.passed}/${result.total} passed`);
  }

  const skippedList = skipped.length ? skipped.join(', ') : 'none';
  console.log(
    `PARITY: ${passed}/${total} passed across ${gamesRun} game(s); skipped: ${skippedList}`
  );
  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
