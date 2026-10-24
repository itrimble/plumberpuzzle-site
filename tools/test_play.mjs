// Drive the playable demo in headless Chrome: real taps and keys, a real leak,
// all three boards to the ask card, then a Reduce Motion pass. Saves screenshots.
//
//   npm i --no-save puppeteer-core@23.11.1
//   (python3 -m http.server 8765 --bind 127.0.0.1 &)
//   node tools/test_play.mjs http://127.0.0.1:8765/ [outdir] [--phone]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const url = new URL(args.find((a) => !a.startsWith('--')) || 'http://127.0.0.1:8765/');
url.searchParams.set('minitest', '1');
const out = args.filter((a) => !a.startsWith('--'))[1] || 'playable-test';
const phone = args.includes('--phone');
mkdirSync(out, { recursive: true });

const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
const errors = [], fails = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const view = phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 900 };

async function open(reduce) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  await page.setViewport(view);
  // Count what Web Audio actually plays: a file that downloads but never starts is silence.
  await page.evaluateOnNewDocument(() => {
    window.__heard = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { if (this.buffer && this.buffer.length > 1) window.__heard.push(this.buffer.duration); return start.apply(this, a); };
  });
  if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url.toString(), { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.getElementById('mini').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForSelector('#mini[data-ready="1"]', { timeout: 10000 });
  return page;
}
const get = (page) => page.evaluate(() => window.__mini.get());
async function tap(page, i) {
  const c = await page.evaluate((n) => window.__mini.cellCentre(n), i);
  if (phone) await page.touchscreen.tap(c.x, c.y); else await page.mouse.click(c.x, c.y);
  await sleep(60);
}

const page = await open(false);
// The live page already loads PostHog (README: marketing pages only); the demo itself must add nothing.
const external = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)
  .filter((n) => !n.startsWith(location.origin) && !/\.posthog\.com\//.test(n)));
check(external.length === 0, `the demo makes no third-party requests (${external.join(', ') || 'none'})`);
const idle0 = (await get(page)).autoTurns;
await sleep(6000);  // board 1 takes a few turns, then flows and pauses on the win
check((await get(page)).autoTurns > idle0 && (await get(page)).state === 'demo', 'the idle board solves itself before Play');
await page.screenshot({ path: `${out}/1-idle.png` });

await page.click('[data-act="start"]');
await sleep(200);
check((await get(page)).state === 'play' && (await get(page)).stage === 0, 'Play starts board 1');

// A real tap turns a pipe and does not scroll the page.
let todo = await page.evaluate(() => window.__mini.todo());
check(todo.length > 0, `board 1 starts unsolved (${todo.length} pipes to turn)`);
const y0 = await page.evaluate(() => scrollY);
await tap(page, todo[0][0]);
check((await get(page)).moves === 1, 'a tap turns a pipe');
check(await page.evaluate(() => scrollY) === y0, 'tapping the board does not scroll the page');

if (!phone) {
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  check((await get(page)).moves === 2, 'arrows then Space turn the pipe under the cursor');
  check(await page.evaluate(() => scrollY) === y0, 'arrow keys and Space do not scroll the page while playing');
}

// Solve board 1 with real taps; it has no clock, so the water releases itself once sealed.
for (let pass = 0; pass < 6; pass++) {
  todo = await page.evaluate(() => window.__mini.todo());
  if (!todo.length) break;
  for (const [i, turns] of todo) for (let k = 0; k < turns; k++) await tap(page, i);
}
check((await get(page)).won, 'tapping every pipe into place seals board 1');
await sleep(900);
await page.screenshot({ path: `${out}/2-flowing.png` });
await page.waitForFunction(() => !document.querySelector('.mini-card').hidden, { timeout: 15000 });
check(await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'H3'), 'the clear card takes focus');
await page.screenshot({ path: `${out}/3-clear.png` });

// Board 2: release the water early on an unsolved board and watch it leak.
await page.click('[data-act="next"]');
await sleep(300);
await page.evaluate(() => window.__mini.calm());
await page.click('[data-act="release"]');
await page.waitForFunction(() => window.__mini.get().leaks === 1, { timeout: 30000 });
check(true, 'an early release on an open board leaks');
await sleep(250);
await page.screenshot({ path: `${out}/4-leak.png` });
check((await get(page)).released === false, 'a leak resets the water');

await page.evaluate(() => window.__mini.win());
await page.waitForFunction(() => !document.querySelector('.mini-card').hidden, { timeout: 15000 });
await page.click('[data-act="next"]');
await sleep(300);
check((await get(page)).stage === 2, 'board 3 is the last');
await page.screenshot({ path: `${out}/5-board3.png` });
await page.evaluate(() => window.__mini.win());
await page.waitForFunction(() => window.__mini.get().state === 'done', { timeout: 15000 });
// The emblems arrive over the network on a live site; give them 5 s, then judge.
await page.waitForFunction(() => [...document.querySelectorAll('.mini-locked img')].every((i) => i.complete), { timeout: 5000 }).catch(() => {});
const card = await page.evaluate(() => ({
  text: document.querySelector('.mini-card').innerText,
  href: (document.querySelector('.mini-card a[data-ct]') || {}).href || '',
  focus: document.activeElement && document.activeElement.tagName,
  imgs: [...document.querySelectorAll('.mini-locked img')].map((i) => i.complete && i.naturalWidth > 0)
}));
check(card.text.includes('3 of 140'), 'the ask card says how much was seen');
check(card.href.includes('apps.apple.com') && card.href.includes('ct=web_demo_end'), 'the store button is the page link with ct=web_demo_end');
check(card.focus === 'H3', 'the ask card takes focus');
check(card.imgs.length === 4 && card.imgs.every(Boolean), 'the four locked emblems load');
await page.screenshot({ path: `${out}/6-ask.png` });
const sounds = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/audio/')).length);
check(sounds >= 10, `the game's sounds load after Play (${sounds})`);
const heard = await page.evaluate(() => window.__heard);
check(heard.some((d) => d > 30), 'the music plays after Play');
check(heard.filter((d) => d < 0.2).length >= 3, `turning pipes plays the game's cues (${heard.length} sounds started)`);

const still = await open(true);
const s0 = await get(still);
await sleep(1200);
check(s0.state === 'still' && (await get(still)).moves === s0.moves, 'Reduce Motion shows a still board until Play');
await still.screenshot({ path: `${out}/7-reduced.png` });

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
console.log(fails.length ? `FAIL: ${fails.length}` : 'PASS');
process.exit(fails.length ? 1 : 0);
