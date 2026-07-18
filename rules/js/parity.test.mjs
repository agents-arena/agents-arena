// js/parity.test.mjs
// Node test: proves WASM rules produce identical behavior to the golden vectors
// (and thus to native Go + TS implementations).
// Run with: node js/parity.test.mjs

import { loadRules } from './rules.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const WASM_PATH = './wasm/rules.wasm';
const GOLDEN_PATH = './testdata/tic-tac-toe.golden.json';

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

async function main() {
  console.log('Loading WASM rules...');
  const rules = await loadRules(WASM_PATH);

  console.log('Loading golden vectors...');
  const goldenRaw = await fs.readFile(path.resolve(GOLDEN_PATH), 'utf8');
  const cases = JSON.parse(goldenRaw);

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
      v = rules.validate('tic-tac-toe', state, move, seat);
    } catch (e) {
      console.error(`FAIL ${name}: validate threw: ${e.message}`);
      process.exit(1);
    }
    const valid = !!v.ok;
    const reason = v.reason || '';

    if (valid !== expectValid) {
      console.error(`FAIL ${name}: validate ok=${valid} want=${expectValid} (reason=${reason})`);
      process.exit(1);
    }
    if (!valid && expectReason && reason !== expectReason) {
      console.error(`FAIL ${name}: reason=${JSON.stringify(reason)} want=${JSON.stringify(expectReason)}`);
      process.exit(1);
    }

    if (!valid) {
      passed++;
      continue;
    }

    // 2. apply + terminal
    let after;
    try {
      after = rules.apply('tic-tac-toe', state, move);
    } catch (e) {
      console.error(`FAIL ${name}: apply threw: ${e.message}`);
      process.exit(1);
    }

    let gotRes;
    try {
      gotRes = rules.terminal('tic-tac-toe', after);
    } catch (e) {
      console.error(`FAIL ${name}: terminal threw: ${e.message}`);
      process.exit(1);
    }

    if (expectRes == null) {
      if (gotRes != null) {
        console.error(`FAIL ${name}: unexpected terminal after apply: ${JSON.stringify(gotRes)}`);
        process.exit(1);
      }
    } else {
      if (gotRes == null) {
        console.error(`FAIL ${name}: expected terminal result, got null`);
        process.exit(1);
      }
      if (gotRes.kind !== expectRes.kind) {
        console.error(`FAIL ${name}: result.kind=${gotRes.kind} want=${expectRes.kind}`);
        process.exit(1);
      }
      if (expectRes.winner != null && gotRes.winner !== expectRes.winner) {
        console.error(`FAIL ${name}: result.winner=${gotRes.winner} want=${expectRes.winner}`);
        process.exit(1);
      }
      if (expectRes.reason && gotRes.reason !== expectRes.reason) {
        console.error(`FAIL ${name}: result.reason=${gotRes.reason} want=${expectRes.reason}`);
        process.exit(1);
      }
    }

    passed++;
  }

  console.log(`PARITY: ${passed}/${total} passed`);
  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('UNEXPECTED ERROR:', err);
  process.exit(1);
});
