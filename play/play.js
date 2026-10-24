/* Plumber Puzzle playable demo: three boards from the game, its art and its sound.
   Rules: play/rules.js (the game's model, parity-tested). Pressure, leaks, surge and
   scoring follow godot/scripts/game.gd _tick_pressure, trigger_leak, _release_water
   and run_scoring.gd, with the clock softened 1.5x for a first-time player.
   Before Play it solves boards by itself; under Reduce Motion it is a still frame.
   docs: ~/projects/site-templates/docs/PLAYABLE-DEMO.md */
(function () {
  'use strict';
  var root = document.getElementById('mini');
  if (!root || !window.PPRules || !window.PP_LEVELS) return;
  var R = window.PPRules, LEVELS = window.PP_LEVELS, BASE = root.getAttribute('data-base') || 'play/';
  var canvas = root.querySelector('canvas');
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var draw = new window.PPDraw(canvas, { still: still });
  var sound = new window.PPSound(BASE);
  var ui = {
    start: root.querySelector('.mini-start'), card: root.querySelector('.mini-card'), live: root.querySelector('[data-mini="live"]'),
    hint: root.querySelector('[data-mini="hint"]'), release: root.querySelector('[data-act="release"]'),
    pause: root.querySelector('[data-act="pause"]'), soundBtn: root.querySelector('[data-act="sound"]'), toast: root.querySelector('.mini-toast')
  };
  function $(k) { return root.querySelector('[data-mini="' + k + '"]'); }
  var test = /[?&]minitest\b/.test(location.search);
  var HINTS = [
    'Tap a pipe to turn it. Join the valve to the drain, with no pipe left over.',
    'The water now comes on its own. Seal the run before the gauge empties, or release it early for a bonus.',
    'Crosses stay put. Turn the tees so every pipe joins one network.'
  ];

  var state = 'demo', stage = 0, demoStage = 0, total = 0, deaths = 0, running = false, visible = true, last = 0;
  var autoTurns = 0, best = 0, keyboard = false, cursor = 0, calm = false, autoAt = 0, winAt = 0;
  var S = null;  // the stage in play: board, flow cache and pressure clock
  try { best = +localStorage.getItem('pp-mini-best') || 0; } catch (e) { /* storage off */ }

  function track(name, props) { if (window.posthog && window.posthog.capture) window.posthog.capture(name, props || {}); }
  function say(text) { if (ui.live) ui.live.textContent = text; }
  function toast(text) {
    if (!ui.toast) return;
    ui.toast.textContent = text; ui.toast.hidden = false; ui.toast.classList.remove('show'); void ui.toast.offsetWidth; ui.toast.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(function () { ui.toast.hidden = true; }, 1900);
  }

  function setup(n, auto) {
    var lv = LEVELS[n];
    S = { lv: lv, board: new R.Board(lv), moves: 0, leaks: 0, released: false, water: 0, grace: 0, flowT: 0,
      escalation: 1, cooldown: 0, surge: 1, wetCount: 0, auto: !!auto, won: false, warned: false, autoRelease: -1 };
    cursor = S.board.positions(R.KIND.SOURCE)[0] || 0;
    reflow();
    if (!auto) { hud(); if (ui.hint) ui.hint.textContent = HINTS[n] || ''; }
  }

  function reflow() {
    S.steps = S.board.flow();
    S.dist = {}; S.byI = {}; S.max = 0;
    S.steps.forEach(function (s) { if (S.dist[s.i] === undefined) { S.dist[s.i] = s.distance; S.byI[s.i] = s; } S.max = Math.max(S.max, s.distance); });
    S.won = S.board.isWon();
  }

  // board_view.gd _progress_for_distance: the faucet is always full; the rest fill as the water passes.
  function progress(i) {
    var d = S.dist[i];
    if (d === undefined) return 0;
    if (d === 0) return 1;
    if (!S.released) return 0;
    return Math.max(0, Math.min(1, S.water - (d - 1)));
  }

  function graceLeft() { return Math.max(0, S.lv.grace - S.grace); }

  function release(manual) {
    if (S.released) return;
    if (manual && S.lv.clock) {
      S.surge = R.surgeFor(graceLeft() / S.lv.grace);
      if (S.surge > 1.05) toast('×' + S.surge.toFixed(2) + ' banked — a leak will cost it');
      else toast('Water released');
    }
    S.released = true; S.water = 0; S.flowT = 0; S.wetCount = 1;
    if (!S.auto) { sound.play('surge', 0.55); sound.flowing(true); }
    var src = S.board.positions(R.KIND.SOURCE)[0], c = draw.centre(src);
    draw.burst(c.x, c.y, 14, '#bfefff', 120, true);
    hud();
  }

  function leak() {
    var dead = S.board.firstDeadEnd();
    S.leaks++; S.cooldown = S.lv.leakCooldown; S.flowT = 0; S.released = false; S.water = 0; S.surge = 1;
    S.grace = S.lv.grace * (1 - S.lv.leakGraceFraction); S.escalation *= 1.14; S.warned = false;
    if (dead) draw.jet(dead.i, dead.dir);
    if (S.auto) return;
    sound.flowing(false); sound.play('leak', 0.8);
    if (S.leaks >= R.maxLeaks(S.lv.id)) return fail();
    toast('Leak! Reroute before the next surge');
    say('Leak. ' + (R.maxLeaks(S.lv.id) - S.leaks) + ' left.');
    hud();
  }

  function tick(dt) {
    if (!S) return;
    if (state === 'demo') return autopilot(dt);
    if (state !== 'play') return;
    S.cooldown = Math.max(0, S.cooldown - dt);
    if (!S.released) {
      if (S.lv.clock && !calm) {
        S.grace += dt;
        if (!S.warned && graceLeft() < 3.2) { S.warned = true; sound.play('warning', 0.5); }
        if (S.grace >= S.lv.grace) release(false);
      } else if (!S.lv.clock && S.autoRelease >= 0 && (S.autoRelease -= dt) <= 0) { S.autoRelease = -1; release(false); }
    } else flow(dt);
    hud();
  }

  // game.gd _tick_pressure once released: vent at 0.28 after a leak, speed up the longer it runs.
  function flow(dt) {
    var vent = S.cooldown > 0 ? 0.28 : 1;
    S.flowT += dt;
    S.water += dt / Math.max(S.lv.travel, 0.05) * S.escalation * vent * (1 + S.flowT * S.lv.rampPerSecond);
    var wet = Math.min(S.steps.length, Math.max(1, Math.floor(S.water) + 1));
    if (wet > S.wetCount && !S.auto) sound.play('tile_fill', 0.35);
    S.wetCount = wet;
    if (S.water >= S.max && S.won) return clear();
    if (wet >= S.steps.length && !S.won && S.cooldown <= 0) leak();
  }

  function rotate(i) {
    if (!S || i < 0 || (state !== 'play' && !S.auto)) return;
    if (!S.board.rotatable(i)) { if (!S.auto) { draw.reject(i); sound.play('invalid', 0.5); } return; }
    if (S.released && progress(i) > 0.02) {
      if (!S.auto) { draw.reject(i); sound.play('invalid', 0.5); toast('Wet pipes are locked'); }
      return;
    }
    S.board.rotate(i); S.moves++; draw.startSpin(i);
    reflow();
    if (!S.auto) sound.play('rotate', 0.6);
    if (S.won && !S.released) {
      if (S.auto) release(false);
      else {
        sound.play('lock_in', 0.6);
        if (!S.lv.clock) S.autoRelease = 0.45;
        else toast('Sealed! Release the water now for a bonus');
      }
    }
    if (!S.auto) hud();
  }

  // Before Play: turn the next unsolved pipe in reading order, then let it flow and move on.
  function autopilot(dt) {
    if (S.released) {
      S.water += dt / 0.22;
      if (S.water >= S.max + 1 && !winAt) { winAt = 1.6; var c = draw.centre(S.board.positions(R.KIND.DRAIN)[0]); draw.burst(c.x, c.y, 24, '#ffd66b', 140); }
      if (winAt && (winAt -= dt) <= 0) { winAt = 0; demoStage = (demoStage + 1) % 2; setup(demoStage, true); }
      return;
    }
    if ((autoAt -= dt) > 0) return;
    autoAt = 0.42;
    for (var i = 0; i < S.board.kind.length; i++) if (S.board.rotatable(i) && S.board.turnsToSolve(i) > 0) { rotate(i); autoTurns++; return; }
  }

  function clear() {
    var stars = R.stars(S.lv.par, S.moves, S.leaks), pts = R.score(S.lv.par, S.moves, S.surge, S.leaks);
    total += pts; state = 'cleared'; sound.flowing(false); sound.play('level_clear', 0.8);
    var c = draw.centre(S.board.positions(R.KIND.DRAIN)[0]);
    draw.burst(c.x, c.y, 40, '#ffd66b', 180);
    track('mini_stage_clear', { stage: stage + 1, moves: S.moves, leaks: S.leaks, score: total });
    say('Board clear. ' + stars + ' stars.');
    if (total > best) { best = total; try { localStorage.setItem('pp-mini-best', best); } catch (e) { /* storage off */ } }
    setTimeout(function () {
      if (stage === LEVELS.length - 1) return ask();
      card('<p class="eyebrow">Board ' + (stage + 1) + ' of ' + LEVELS.length + ' clear</p>' +
        '<h3 tabindex="-1">' + starRow(stars) + '</h3>' +
        '<p>' + S.moves + ' moves &middot; par ' + S.lv.par + (S.leaks ? ' &middot; ' + S.leaks + ' leak' + (S.leaks > 1 ? 's' : '') : '') + ' &middot; ' + pts.toLocaleString() + ' points</p>' +
        '<div class="mini-actions"><button class="btn primary" type="button" data-act="next">Next board</button></div>');
    }, still ? 300 : 1400);
  }

  function starRow(n) {
    var s = '';
    for (var k = 0; k < 3; k++) s += '<span class="star' + (k < n ? ' on' : '') + '" aria-hidden="true">★</span>';
    return s + '<span class="sr-only">' + n + ' of 3 stars</span>';
  }

  function fail() {
    state = 'failed'; deaths++;
    track('mini_game_over', { stage: stage + 1, deaths: deaths });
    say('Out of leaks. Try again.');
    card('<p class="eyebrow">Out of leaks</p><h3 tabindex="-1">The water found an open pipe.</h3>' +
      '<p>Every board can be sealed: turn each pipe until it meets its neighbours. Retries are free.</p>' +
      '<div class="mini-actions"><button class="btn primary" type="button" data-act="retry">Try again</button>' +
      (deaths >= 3 ? '<a class="btn ghost" data-ct="web_demo_skip" href="' + storeUrl('web_demo_skip') + '">Or get the full game</a>' : '') + '</div>');
  }

  function storeUrl(ct) {
    var a = document.querySelector('a[href*="apps.apple.com"]');
    if (!a) return '#';
    try { var u = new URL(a.href); u.searchParams.set('ct', ct); return u.toString(); } catch (e) { return a.href; }
  }

  function ask() {
    state = 'done';
    track('mini_ask_shown', { score: total });
    try { localStorage.setItem('pp-mini-done', '1'); } catch (e) { /* storage off */ }
    var emblems = ['RapidFlow', 'PerfectSeal', 'DailyDive', 'EndlessDescent'].map(function (n) {
      return '<span class="lock"><img src="' + BASE + 'props/EmblemChallenge' + n + '.webp" alt="" width="56" height="56" loading="lazy"></span>';
    }).join('');
    card('<p class="eyebrow">Demo complete</p><h3 tabindex="-1">All three boards sealed.</h3>' +
      '<p class="mini-big">' + LEVELS.length + ' boards cleared &middot; ' + total.toLocaleString() + ' points</p>' +
      '<p>That was 3 of 140.</p><div class="mini-locked" aria-label="Locked in the demo: Rapid Flow, Perfect Seal, Daily Dive and Endless Descent">' + emblems + '</div>' +
      '<p>The full game has 140 handcrafted levels in seven chapters, four challenge modes and 48 trophies. $2.99 once: no ads, no account.</p>' +
      '<div class="mini-actions"><a class="btn primary" data-ct="web_demo_end" href="' + storeUrl('web_demo_end') + '">Get it on the App Store</a>' +
      '<button class="btn ghost" type="button" data-act="again">Play again</button></div>');
  }

  function card(html) {
    ui.card.innerHTML = html; ui.card.hidden = false; root.classList.add('carded');
    ui.card.querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', act); });
    ui.card.querySelectorAll('a[data-ct]').forEach(function (a) { a.addEventListener('click', function () { track('mini_store_click', { ct: a.dataset.ct, stage: stage + 1, score: total }); }); });
    var h = ui.card.querySelector('h3'); if (h) h.focus({ preventScroll: true });
  }
  function hideCard() { ui.card.hidden = true; root.classList.remove('carded'); }

  function play(n) {
    hideCard(); ui.start.hidden = true; root.classList.add('playing');
    stage = n; state = 'play'; winAt = 0; setup(n, false); calm = calm && test;
    sound.start(); sound.flowing(false);
    if (ui.pause) ui.pause.hidden = false;
    if (n === 0) { total = 0; track('mini_play_start', {}); }
    say('Board ' + (n + 1) + ' of ' + LEVELS.length + ', ' + S.lv.name + '. ' + HINTS[n]);
    canvas.focus({ preventScroll: true });
    start();
  }

  function pauseGame() {
    if (state !== 'play') return;
    state = 'paused'; sound.suspend(); sound.flowing(false);
    card('<p class="eyebrow">Paused</p><h3 tabindex="-1">The water waits.</h3><div class="mini-actions"><button class="btn primary" type="button" data-act="resume">Resume</button></div>');
  }

  function act(e) {
    var a = e.currentTarget.getAttribute('data-act');
    if (a === 'start') play(0);
    else if (a === 'next') play(stage + 1);
    else if (a === 'retry') play(stage);
    else if (a === 'again') { deaths = 0; play(0); }
    else if (a === 'resume') { hideCard(); state = 'play'; sound.resume(); if (S.released) sound.flowing(true); canvas.focus({ preventScroll: true }); }
    else if (a === 'pause') pauseGame();
    else if (a === 'release' && state === 'play') { if (!S.released) release(true); }
    else if (a === 'sound') soundToggle();
  }

  function soundToggle() {
    var on = sound.toggle();
    if (ui.soundBtn) { ui.soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); ui.soundBtn.setAttribute('aria-label', on ? 'Sound on (M to mute)' : 'Sound off (M to unmute)'); }
  }

  function hud() {
    if (!S || S.auto) return;
    var cap = R.maxLeaks(S.lv.id), pips = '';
    for (var k = 0; k < cap; k++) pips += '<i class="' + (k < S.leaks ? 'used' : '') + '"></i>';
    $('stage').textContent = 'Board ' + (stage + 1) + '/' + LEVELS.length + ' · ' + S.lv.name;
    $('moves').textContent = S.moves + ' / ' + S.lv.par;
    $('leaks').innerHTML = pips;
    $('score').textContent = total.toLocaleString();
    var frac = S.lv.clock ? (S.released ? 0 : graceLeft() / S.lv.grace) : 1;
    $('gauge').style.transform = 'scaleX(' + frac.toFixed(3) + ')';
    root.classList.toggle('urgent', S.lv.clock && !S.released && graceLeft() < 3.2);
    $('water').textContent = S.released ? (S.cooldown > 0 ? 'Venting' : 'Flowing') : (S.lv.clock ? 'Water in ' + Math.ceil(graceLeft()) + 's' : (S.won ? 'Sealed' : 'No clock'));
    if (ui.release) ui.release.disabled = S.released || state !== 'play';
  }

  function render(dt) {
    draw.resize();
    draw.step(dt);
    draw.render({ board: S && S.board, progress: progress, step: function (i) { return S.byI[i] || { dx: 1, dy: 0, distance: 0 }; },
      cursor: cursor, showCursor: keyboard && state === 'play', glow: S && S.won ? (S.released ? 1 : 0.5) : 0 });
  }

  function frame(t) {
    if (!running) return;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    tick(dt); render(dt);
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible && state !== 'still') { running = true; last = 0; requestAnimationFrame(frame); } }
  function stop() { running = false; }

  // Input: a tap or click turns a pipe; keys only while a board is in play.
  canvas.addEventListener('pointerdown', function (e) {
    if (state === 'demo' || state === 'still') return;
    var r = canvas.getBoundingClientRect(), i = draw.cellAt(e.clientX - r.left, e.clientY - r.top);
    keyboard = false;
    if (i >= 0) { cursor = i; rotate(i); }
  });
  document.addEventListener('keydown', function (e) {
    if (state !== 'play' && state !== 'paused') return;
    var k = e.key, b = S.board, x = cursor % b.w, y = (cursor / b.w) | 0, moved = true;
    if (k === 'Escape') { if (state === 'play') pauseGame(); return; }
    if (state !== 'play') return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') x = Math.max(0, x - 1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') x = Math.min(b.w - 1, x + 1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') y = Math.max(0, y - 1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') y = Math.min(b.h - 1, y + 1);
    else moved = false;
    if (moved) { keyboard = true; cursor = y * b.w + x; e.preventDefault(); return; }
    if (k === ' ' || k === 'Enter') { if (document.activeElement && document.activeElement.tagName === 'BUTTON') return; keyboard = true; rotate(cursor); e.preventDefault(); }
    else if (k === 'e' || k === 'E') { if (!S.released) release(true); }
    else if (k === 'm' || k === 'M') soundToggle();
    else if (k === 'r' || k === 'R') play(stage);
  });
  root.querySelectorAll('.mini-start [data-act], .mini-tools [data-act], [data-act="release"]').forEach(function (b) { b.addEventListener('click', act); });

  document.addEventListener('visibilitychange', function () { if (document.hidden) { pauseGame(); stop(); } else start(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (!visible) { pauseGame(); stop(); } else start();
    }, { threshold: 0.2 }).observe(root);
  }
  window.addEventListener('resize', function () { if (!running) render(0); });

  if (best && $('best')) $('best').textContent = 'Your best: ' + best.toLocaleString() + ' points';
  setup(0, true);
  if (still) { state = 'still'; S.board.rot = S.board.solvedRot.slice(); reflow(); S.released = true; S.water = S.max + 1; }
  draw.load(BASE, function () { root.setAttribute('data-ready', '1'); render(0); start(); });
  root.setAttribute('data-renderer', 'canvas2d');

  if (test) window.__mini = {
    get: function () { return { autoTurns: autoTurns, state: state, stage: stage, moves: S.moves, leaks: S.leaks, score: total, won: S.won, released: S.released, water: S.water }; },
    win: function () { S.board.rot = S.board.solvedRot.slice(); reflow(); if (!S.released) release(false); S.water = S.max; },
    calm: function () { calm = true; },
    rotateAt: function (i) { rotate(i); return S.board.rot[i]; },
    todo: function () { var out = []; for (var i = 0; i < S.board.kind.length; i++) if (S.board.rotatable(i) && S.board.turnsToSolve(i)) out.push([i, S.board.turnsToSolve(i)]); return out; },
    cellCentre: function (i) { var c = draw.centre(i), r = canvas.getBoundingClientRect(); return { x: r.left + c.x, y: r.top + c.y }; }
  };
})();
