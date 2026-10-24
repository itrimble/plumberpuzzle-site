/* Plumber Puzzle demo renderer: Canvas 2D, the game's own tile art.
   play/pipes.webp is an 8 x 8 atlas: column = tile kind, row = rotation * 2 + wet.
   Water fills each tile from the side it enters, as the game's flow mask does
   (board_view.gd _progress_for_distance), and a brightness wave runs down the
   wet pipes. Everything that moves stops under Reduce Motion. */
(function (root) {
  'use strict';
  var CELL = 128;

  function Draw(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.still = !!opts.still;
    this.atlas = null;
    this.props = {};
    this.parts = [];
    this.fish = [];
    this.bubbles = [];
    this.spin = {};
    this.flash = {};
    this.time = 0;
    this.layout = { size: 0, tile: 0, ox: 0, oy: 0, w: 0, h: 0 };
  }

  Draw.prototype.load = function (base, onReady) {
    var self = this, img = new Image();
    img.decoding = 'async';
    img.onload = function () { self.atlas = img; onReady(); };
    img.src = base + 'pipes.webp';
    ['PropFishBlue', 'PropFishYellow', 'PropFishClown', 'PropLightRayWide', 'PropLightRayTall'].forEach(function (n) {
      var p = new Image(); p.decoding = 'async'; p.src = base + 'props/' + n + '.webp'; self.props[n] = p;
    });
  };

  Draw.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect(), dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.dpr = dpr;
    this.cssW = r.width; this.cssH = r.height;
  };

  // The board is fitted to the canvas with a margin; 7x9 and 9x7 boards share a tile size.
  Draw.prototype.fit = function (board) {
    var W = this.cssW, H = this.cssH, span = Math.max(board.w, board.h) + 0.5;
    var tile = Math.floor(Math.min(W, H) / span);
    this.layout = { tile: tile, w: board.w, h: board.h, ox: Math.round((W - tile * board.w) / 2), oy: Math.round((H - tile * board.h) / 2) };
    return this.layout;
  };

  Draw.prototype.cellAt = function (px, py) {
    var L = this.layout, x = Math.floor((px - L.ox) / L.tile), y = Math.floor((py - L.oy) / L.tile);
    return (x < 0 || y < 0 || x >= L.w || y >= L.h) ? -1 : y * L.w + x;
  };

  Draw.prototype.centre = function (i) {
    var L = this.layout;
    return { x: L.ox + (i % L.w + 0.5) * L.tile, y: L.oy + (((i / L.w) | 0) + 0.5) * L.tile };
  };

  Draw.prototype.startSpin = function (i) { if (!this.still) this.spin[i] = 0; };
  Draw.prototype.reject = function (i) { this.flash[i] = 0; };

  Draw.prototype.burst = function (x, y, n, color, speed, up) {
    if (this.still) return;
    for (var k = 0; k < n; k++) {
      var a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0.6 + Math.random() * 0.7, r: 1.5 + Math.random() * 2.5, c: color });
    }
  };

  // A jet from a dead end: the open side of the tile, sprayed outward.
  Draw.prototype.jet = function (i, dir) {
    var c = this.centre(i), L = this.layout, dx = [0, 1, 0, -1][dir], dy = [-1, 0, 1, 0][dir];
    var x = c.x + dx * L.tile * 0.45, y = c.y + dy * L.tile * 0.45;
    if (this.still) return;
    for (var k = 0; k < 26; k++) {
      var s = 90 + Math.random() * 160, j = (Math.random() - 0.5) * 0.9;
      this.parts.push({ x: x, y: y, vx: (dx + j * dy) * s, vy: (dy + j * dx) * s, t: 0.5 + Math.random() * 0.5, r: 2 + Math.random() * 2.5, c: k % 3 ? '#7ad7ff' : '#ff8a4c' });
    }
  };

  Draw.prototype.step = function (dt) {
    this.time += dt;
    var k;
    for (k in this.spin) { this.spin[k] += dt / 0.14; if (this.spin[k] >= 1) delete this.spin[k]; }
    for (k in this.flash) { this.flash[k] += dt / 0.35; if (this.flash[k] >= 1) delete this.flash[k]; }
    this.parts = this.parts.filter(function (p) { p.t -= dt; p.vy += 160 * dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t > 0; });
    if (this.still) return;
    var W = this.cssW, H = this.cssH;
    if (this.fish.length < 3 && Math.random() < dt * 0.25) {
      var names = ['PropFishBlue', 'PropFishYellow', 'PropFishClown'], left = Math.random() < 0.5;
      this.fish.push({ n: names[(Math.random() * 3) | 0], x: left ? -60 : W + 60, y: H * (0.15 + Math.random() * 0.7), v: (left ? 1 : -1) * (12 + Math.random() * 16), s: 0.12 + Math.random() * 0.1 });
    }
    this.fish = this.fish.filter(function (f) { f.x += f.v * dt; return f.x > -80 && f.x < W + 80; });
    if (this.bubbles.length < 18 && Math.random() < dt * 3) this.bubbles.push({ x: Math.random() * W, y: H + 6, r: 1 + Math.random() * 2.6, v: 14 + Math.random() * 22, w: Math.random() * 6 });
    this.bubbles = this.bubbles.filter(function (b) { b.y -= b.v * dt; b.x += Math.sin(b.y / 18 + b.w) * 0.15; return b.y > -8; });
  };

  Draw.prototype.backdrop = function (ctx) {
    var W = this.cssW, H = this.cssH, g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0d3553'); g.addColorStop(0.55, '#08233a'); g.addColorStop(1, '#041320');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var ray = this.props.PropLightRayWide, tall = this.props.PropLightRayTall, sway = this.still ? 0 : Math.sin(this.time * 0.35) * 0.06;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.16;
    if (ray && ray.complete && ray.naturalWidth) { ctx.save(); ctx.translate(W * 0.3, -10); ctx.rotate(sway); ctx.drawImage(ray, -W * 0.25, 0, W * 0.5, H * 0.75); ctx.restore(); }
    if (tall && tall.complete && tall.naturalWidth) { ctx.save(); ctx.translate(W * 0.78, -10); ctx.rotate(-sway * 0.8); ctx.drawImage(tall, -W * 0.12, 0, W * 0.24, H * 0.85); ctx.restore(); }
    ctx.restore();
    var self = this;
    this.fish.forEach(function (f) {
      var im = self.props[f.n];
      if (!im || !im.complete || !im.naturalWidth) return;
      var w = im.naturalWidth * f.s * 1.6, h = im.naturalHeight * f.s * 1.6;
      ctx.save(); ctx.globalAlpha = 0.4; ctx.translate(f.x, f.y + Math.sin(self.time + f.x / 40) * 3);
      if (f.v < 0) ctx.scale(-1, 1);
      ctx.drawImage(im, -w / 2, -h / 2, w, h); ctx.restore();
    });
    ctx.fillStyle = 'rgba(180,230,255,0.35)';
    this.bubbles.forEach(function (b) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); });
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  Draw.prototype.tile = function (ctx, kind, rot, wet, x, y, t) {
    ctx.drawImage(this.atlas, kind * CELL, (rot * 2 + (wet ? 1 : 0)) * CELL, CELL, CELL, x, y, t, t);
  };

  // view: { board, progress(i) -> 0..1, step(i) -> {dx,dy,distance}, cursor, showCursor, glow }
  Draw.prototype.render = function (view) {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.backdrop(ctx);
    if (!this.atlas || !view.board) return;
    var b = view.board, L = this.fit(b), t = L.tile, i;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    roundRect(ctx, L.ox - t * 0.12, L.oy - t * 0.12, t * (b.w + 0.24), t * (b.h + 0.24), t * 0.22);
    ctx.fillStyle = 'rgba(4,16,28,0.78)'; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(125,190,225,0.22)'; ctx.lineWidth = 1.5; ctx.stroke();
    for (i = 0; i < b.kind.length; i++) {
      var x = L.ox + (i % b.w) * t, y = L.oy + ((i / b.w) | 0) * t, kind = b.kind[i], rot = b.rot[i];
      var spinning = this.spin[i] !== undefined;
      if (spinning) {
        var e = 1 - Math.pow(1 - this.spin[i], 3);
        this.tile(ctx, 0, 0, false, x, y, t);
        ctx.save(); ctx.translate(x + t / 2, y + t / 2); ctx.rotate(-(1 - e) * Math.PI / 2);
        this.tile(ctx, kind, rot, false, -t / 2, -t / 2, t); ctx.restore();
        continue;
      }
      this.tile(ctx, kind, rot, false, x, y, t);
      var p = kind ? view.progress(i) : 0;
      if (p > 0.001) {
        var s = view.step(i);
        ctx.save();
        if (p < 0.999) {
          ctx.beginPath();
          if (s.dx > 0) ctx.rect(x, y, t * p, t);
          else if (s.dx < 0) ctx.rect(x + t * (1 - p), y, t * p, t);
          else if (s.dy > 0) ctx.rect(x, y, t, t * p);
          else ctx.rect(x, y + t * (1 - p), t, t * p);
          ctx.clip();
        }
        this.tile(ctx, kind, rot, true, x, y, t);
        if (!this.still && p >= 0.999) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.16 * (0.5 + 0.5 * Math.sin(this.time * 4 - s.distance * 0.9));
          this.tile(ctx, kind, rot, true, x, y, t);
        }
        ctx.restore();
      }
      if (this.flash[i] !== undefined) {
        ctx.fillStyle = 'rgba(255,90,60,' + (0.45 * (1 - this.flash[i])) + ')';
        roundRect(ctx, x + 2, y + 2, t - 4, t - 4, t * 0.16); ctx.fill();
      }
    }
    if (view.glow > 0) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,214,120,' + (0.55 * view.glow) + ')'; ctx.lineWidth = 3;
      roundRect(ctx, L.ox - t * 0.12, L.oy - t * 0.12, t * (b.w + 0.24), t * (b.h + 0.24), t * 0.22); ctx.stroke();
      ctx.restore();
    }
    if (view.showCursor && view.cursor >= 0) {
      var cx = L.ox + (view.cursor % b.w) * t, cy = L.oy + ((view.cursor / b.w) | 0) * t;
      ctx.strokeStyle = '#ffd66b'; ctx.lineWidth = 3;
      roundRect(ctx, cx + 2, cy + 2, t - 4, t - 4, t * 0.18); ctx.stroke();
    }
    this.parts.forEach(function (q) {
      ctx.globalAlpha = Math.min(1, q.t * 2); ctx.fillStyle = q.c;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  };

  root.PPDraw = Draw;
})(this);
