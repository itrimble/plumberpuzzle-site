// Parity: play/rules.js against the game's Python reference model (tools/rules_trace.py).
// usage: node tools/test_rules.mjs   (exit 0 = every state matches)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const here = new URL('..', import.meta.url).pathname;
const R = createRequire(import.meta.url)(here + 'play/rules.js');
const ctx = { window: {} };
vm.runInNewContext(readFileSync(here + 'play/levels.js', 'utf8'), ctx);
const levels = ctx.window.PP_LEVELS;
const trace = JSON.parse(execFileSync('python3', ['-B', here + 'tools/rules_trace.py'], { maxBuffer: 1 << 28 }));

let checked = 0, failed = 0;
for (const lv of trace) {
  const level = levels.find((l) => l.id === lv.id);
  const board = new R.Board(level);
  for (const s of lv.states) {
    if (s.move === 'solved') board.rot = level.solved.split('').map(Number);
    else if (s.move !== null) board.rotate(s.move);
    const flow = board.flow().map((f) => [f.i, f.distance, f.dx, f.dy]);
    const dead = board.firstDeadEnd();
    const same = board.rot.join('') === s.rot && JSON.stringify(flow) === JSON.stringify(s.flow)
      && board.isWon() === s.won && (dead ? dead.i : null) === s.dead;
    checked++;
    if (!same && failed++ < 5) console.log(`MISMATCH level ${lv.id} move ${s.move}`);
    if (s.move === 'solved') board.rot = level.start.split('').map(Number);
  }
  const wins = lv.states.filter((s) => s.won).length;
  console.log(`level ${lv.id}: ${lv.states.length} states, ${wins} won, ${lv.states.filter((s) => s.dead !== null).length} with a dead end`);
  if (!lv.states[1].won || lv.states[0].won) { console.log(`level ${lv.id}: solved board must win and the start must not`); failed++; }
}
console.log(checked === 0 ? 'FAIL: no states checked' : `${failed ? 'FAIL' : 'PASS'}: ${checked} states, ${failed} mismatches`);
process.exit(checked === 0 || failed ? 1 : 0);
