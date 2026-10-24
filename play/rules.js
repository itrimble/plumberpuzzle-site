/* Plumber Puzzle rules for the web demo: a port of the game's pure model.
   Sources: godot/scripts/pipe_tile.gd, pipe_board.gd and direction.gd, themselves
   ports of PipeTile.swift and PipeBoard.swift. Only what the demo needs: openings,
   the source-rooted walk (solveFlowWithDirections), the NetWalk win and dead ends.
   No DOM; tools/test_rules.mjs checks it against the game's Python reference model. */
(function (root) {
  'use strict';
  var UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
  var EMPTY = 0, STRAIGHT = 1, CORNER = 2, TEE = 3, CROSS = 4, SOURCE = 5, DRAIN = 6, BRIDGE = 7;
  var BASE = [[], [UP, DOWN], [UP, RIGHT], [UP, RIGHT, LEFT], [UP, RIGHT, DOWN, LEFT], [RIGHT], [LEFT], [UP, RIGHT, DOWN, LEFT]];
  var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];

  function opposite(d) { return (d + 2) % 4; }
  function canRotate(kind) { return kind !== EMPTY && kind !== CROSS && kind !== BRIDGE; }
  function mask(kind, rot) {
    var m = 0;
    BASE[kind].forEach(function (d) { m |= 1 << ((d + rot) % 4); });
    return m;
  }

  // A board: w, h, kind[] and rot[] (row-major, y down, as in levels.json).
  // Sources and drains are fixed; levels.js already holds the scrambled start.
  function Board(level) {
    this.w = level.w; this.h = level.h;
    this.kind = level.kinds.split('').map(Number);
    this.rot = level.start.split('').map(Number);
    this.solvedRot = level.solved.split('').map(Number);
  }
  Board.prototype.inside = function (x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; };
  Board.prototype.at = function (x, y) { return y * this.w + x; };
  Board.prototype.mask = function (i) { return mask(this.kind[i], this.rot[i]); };
  Board.prototype.opens = function (i, d) { return (this.mask(i) & (1 << d)) !== 0; };
  Board.prototype.rotatable = function (i) {
    var k = this.kind[i];
    return canRotate(k) && k !== SOURCE && k !== DRAIN;
  };
  Board.prototype.rotate = function (i) {
    if (!this.rotatable(i)) return false;
    this.rot[i] = (this.rot[i] + 1) % 4;
    return true;
  };
  Board.prototype.positions = function (kind) {
    var out = [];
    for (var i = 0; i < this.kind.length; i++) if (this.kind[i] === kind) out.push(i);
    return out;
  };

  // exits(from:entered:): a faucet opens every way; a bridge goes straight on;
  // every other piece is a junction that never sends water back.
  Board.prototype.exits = function (i, entered) {
    var m = this.mask(i), out = [], d;
    if (entered < 0) { for (d = 0; d < 4; d++) if (m & (1 << d)) out.push(d); return out; }
    if (this.kind[i] === BRIDGE) return (m & (1 << entered)) ? [entered] : [];
    var back = opposite(entered);
    for (d = 0; d < 4; d++) if ((m & (1 << d)) && d !== back) out.push(d);
    return out;
  };

  // walkStates then walk: one visit per (cell, heading), first arrival per cell.
  // Returns solve_flow's steps in BFS order: {i, distance, dx, dy}.
  Board.prototype.flow = function (starts) {
    var self = this, seen = {}, reached = {}, queue = [], steps = [];
    function visit(i, heading, distance) {
      if (reached[i]) return;
      reached[i] = true;
      var travel = heading;
      if (travel < 0) {
        travel = RIGHT;
        for (var d = 0; d < 4; d++) if (self.mask(i) & (1 << d)) { travel = d; break; }
      }
      steps.push({ i: i, distance: distance, dx: DX[travel], dy: DY[travel] });
    }
    (starts || this.positions(SOURCE)).forEach(function (i) {
      if (self.kind[i] === EMPTY || seen[i + ':-1']) return;
      seen[i + ':-1'] = true;
      queue.push([i, -1, 0]);
      visit(i, -1, 0);
    });
    for (var head = 0; head < queue.length; head++) {
      var item = queue[head], i = item[0], x = i % this.w, y = (i / this.w) | 0;
      this.exits(i, item[1]).forEach(function (dir) {
        var nx = x + DX[dir], ny = y + DY[dir];
        if (!self.inside(nx, ny)) return;
        var n = self.at(nx, ny);
        if (!self.opens(n, opposite(dir))) return;
        var key = n + ':' + dir;
        if (seen[key]) return;
        seen[key] = true;
        queue.push([n, dir, item[2] + 1]);
        visit(n, dir, item[2] + 1);
      });
    }
    return steps;
  };

  // An opening off the board or into a neighbour that does not open back.
  Board.prototype.leaks = function (i) {
    var x = i % this.w, y = (i / this.w) | 0;
    for (var d = 0; d < 4; d++) {
      if (!this.opens(i, d)) continue;
      var nx = x + DX[d], ny = y + DY[d];
      if (!this.inside(nx, ny) || !this.opens(this.at(nx, ny), opposite(d))) return d;
    }
    return -1;
  };

  // first_pressure_dead_end: the nearest wet tile with an open end, and that end.
  Board.prototype.firstDeadEnd = function () {
    var steps = this.flow(), best = null;
    for (var s = 0; s < steps.length; s++) {
      var d = this.leaks(steps[s].i);
      if (d >= 0 && (!best || steps[s].distance < best.distance)) best = { i: steps[s].i, dir: d, distance: steps[s].distance };
    }
    return best;
  };

  // isWon for an uncoloured board: bridges matched both ways, and one network from
  // the first source holding every source, a drain and every non-empty tile.
  Board.prototype.isWon = function () {
    var self = this, sources = this.positions(SOURCE), drains = this.positions(DRAIN);
    if (this.positions(BRIDGE).some(function (i) { return self.leaks(i) >= 0; })) return false;
    if (!sources.length || !drains.length) return false;
    var net = {};
    this.flow([sources[0]]).forEach(function (s) { net[s.i] = true; });
    if (!sources.every(function (i) { return net[i]; })) return false;
    if (!drains.some(function (i) { return net[i]; })) return false;
    for (var i = 0; i < this.kind.length; i++) if (this.kind[i] !== EMPTY && !net[i]) return false;
    return true;
  };

  // The fewest clockwise turns that give a tile its solved openings (autopilot, hints).
  Board.prototype.turnsToSolve = function (i) {
    var want = mask(this.kind[i], this.solvedRot[i]);
    for (var t = 0; t < 4; t++) if (mask(this.kind[i], (this.rot[i] + t) % 4) === want) return t;
    return 0;
  };

  // RunScoring.live_score and stars (run_scoring.gd); the demo has no chains.
  function score(par, moves, surge, leaks) {
    var base = 1000 + Math.max(0, par * 120 - moves * 90);
    return Math.max(0, Math.floor(Math.max(0, base - leaks * 450) * Math.max(1, surge)));
  }
  function stars(par, moves, leaks) {
    var tier = moves <= par ? 3 : (moves <= Math.ceil(par * 1.5) ? 2 : 1);
    return leaks > 0 ? Math.min(tier, 2) : tier;
  }
  // SurgeBank.release: an early release banks up to 2.5x.
  function surgeFor(unusedFraction) { return Math.min(2.5, 1 + Math.max(0, Math.min(1, unusedFraction)) * 1.5); }
  // PressureProfile.max_leaks.
  function maxLeaks(levelId) { return levelId <= 10 ? 4 : (levelId < 25 ? 3 : 2); }

  var api = {
    Board: Board, mask: mask, score: score, stars: stars, surgeFor: surgeFor, maxLeaks: maxLeaks,
    DX: DX, DY: DY, KIND: { EMPTY: EMPTY, STRAIGHT: STRAIGHT, CORNER: CORNER, TEE: TEE, CROSS: CROSS, SOURCE: SOURCE, DRAIN: DRAIN, BRIDGE: BRIDGE }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PPRules = api;
})(this);
