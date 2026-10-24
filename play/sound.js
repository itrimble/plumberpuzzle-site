/* Plumber Puzzle demo sound: the game's own CC0 cues and music (play/audio/),
   through Web Audio. Nothing loads or plays until the visitor presses Play.
   The water loop runs while water flows, as the game's flow cue does.
   iPhone: Safari mutes Web Audio with the ringer switch unless the page's audio
   session is 'playback', so Play asks for that, as a game or video would. */
(function (root) {
  'use strict';
  var NAMES = ['sfx_rotate', 'sfx_invalid', 'sfx_leak', 'sfx_level_clear', 'sfx_surge', 'sfx_tile_fill', 'sfx_lock_in', 'sfx_warning', 'water_flow_loop', 'music_underwater'];

  function Sound(base) {
    this.base = base; this.ctx = null; this.buf = {}; this.on = true;
    try { this.on = localStorage.getItem('pp-mini-sound') !== 'off'; } catch (e) { /* storage off */ }
    this.music = null; this.water = null;
  }

  // Called from the Play click: everything here must run inside that gesture.
  Sound.prototype.start = function () {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var self = this;
    this.ctx = new AC();
    if (this.ctx.state !== 'running') this.ctx.resume();
    // Older iOS only unlocks output once a buffer plays inside the gesture.
    var blip = this.ctx.createBufferSource();
    blip.buffer = this.ctx.createBuffer(1, 1, 22050); blip.connect(this.ctx.destination); blip.start(0);
    // A compressor keeps stacked cues (fill, surge, music) loud without clipping.
    this.limit = this.ctx.createDynamicsCompressor();
    this.limit.threshold.value = -10; this.limit.ratio.value = 6; this.limit.connect(this.ctx.destination);
    this.master = this.ctx.createGain(); this.master.gain.value = this.on ? 1 : 0; this.master.connect(this.limit);
    NAMES.forEach(function (n) {
      fetch(self.base + 'audio/' + n + '.mp3').then(function (r) { return r.arrayBuffer(); })
        .then(function (a) { return new Promise(function (ok, bad) { self.ctx.decodeAudioData(a, ok, bad); }); })
        .then(function (b) { self.buf[n] = b; if (n === 'music_underwater') self.loopMusic(); })
        .catch(function () { /* a missing cue is not worth breaking the game */ });
    });
  };

  Sound.prototype.voice = function (name, vol, loop) {
    if (!this.ctx || !this.buf[name]) return null;
    var src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = this.buf[name]; src.loop = !!loop; g.gain.value = vol;
    src.connect(g); g.connect(this.master); src.start();
    return { src: src, gain: g };
  };

  Sound.prototype.play = function (name, vol) { this.voice('sfx_' + name, (vol === undefined ? 0.7 : vol) * 1.4, false); };

  Sound.prototype.loopMusic = function () {
    if (this.music || !this.buf.music_underwater) return;
    this.music = this.voice('music_underwater', 0.75, true);
  };

  Sound.prototype.flowing = function (on) {
    if (on && !this.water) this.water = this.voice('water_flow_loop', 0.6, true);
    if (!on && this.water) { try { this.water.src.stop(); } catch (e) { /* already stopped */ } this.water = null; }
  };

  Sound.prototype.toggle = function () {
    this.on = !this.on;
    try { localStorage.setItem('pp-mini-sound', this.on ? 'on' : 'off'); } catch (e) { /* storage off */ }
    if (this.master) this.master.gain.value = this.on ? 1 : 0;
    return this.on;
  };

  Sound.prototype.suspend = function () { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); };
  Sound.prototype.resume = function () { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };

  root.PPSound = Sound;
})(this);
