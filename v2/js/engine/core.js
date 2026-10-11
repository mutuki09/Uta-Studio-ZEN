/* engine/core.js — 音源の共通部分（Web Audio を使わない純粋な計算だけ）。
   ブラウザの再生（player.js）と、ターミナルの書き出し（tools/render.mjs → mixer.js）の両方が使う。
   ・音符 → 各エンジンのイベント（秒単位）
   ・弦楽器で「何弦の何フレット」を決める
   ・響き（ボディ・キャビネット・響板・残響）のインパルス応答を、振動モードとノイズから作る */
(function (root) {
  "use strict";
  var INS = root.instruments;
  var GT = [40, 45, 50, 55, 59, 64], BT = [28, 33, 38, 43];

  function strProfile(snd) { var b = INS.STRINGS[snd.str] || INS.STRINGS.steel, o = {}, k; for (k in b) o[k] = b[k]; for (k in snd.set || {}) o[k] = snd.set[k]; return o; }
  function strParams(key, bass, set) {
    var p = strProfile({ str:key, set:set });
    return { sustain:p.sustain, bright:p.bright, stiff:p.stiff, action:p.action, vel:.8, pos:p.pos, width:.6, mode:p.mode, pickup:p.pickup,
      tm:p.tm, symp:p.symp, detune:p.detune, autoVib:p.autoVib, fretless:!!p.fretless, nStr:bass ? 4 : 6,
      zs:bass ? [2.9, 2.4, 2.0, 1.7] : [1.7, 1.45, 1.2, 1.0, .8, .62], wound:bass ? 0 : 3 };
  }
  /* 音（snd）→ エンジンの種類と最初に送る設定 */
  function engineOf(snd) {
    if (snd.kind === "keys") return { engine:"keys", init:[{ type:"params", p:snd.p }] };
    if (snd.kind === "drum") return { engine:"drum", init:[{ type:"width", v:snd.width === undefined ? .8 : snd.width }] };
    var bass = snd.kind === "bass";
    return { engine:"guitar", init:[{ type:"tuning", midi:bass ? BT : GT }, { type:"params", p:strParams(snd.str, bass, snd.set) }] };
  }

  /* ---------- 弦楽器：音高 → 何弦の何フレット ---------- */
  function fitRange(m, lo, hi) { while (m < lo) m += 12; while (m > hi) m -= 12; return m; }
  function placeMono(m, tuning, last, maxFret) {
    var best = null, cost = 1e9;
    for (var s = 0; s < tuning.length; s++) {
      var f = m - tuning[s];
      if (f < 0 || f > maxFret) continue;
      var c = Math.abs(f - (last ? last.fret : 3)) + (f === 0 ? -.5 : 0) + (last && s !== last.s ? .4 : 0);
      if (c < cost) { cost = c; best = { s:s, fret:f }; }
    }
    return best;
  }
  function placeChord(notes, tuning) {
    var sorted = notes.slice().sort(function (a, b) { return a - b; }), out = [], used = -1;
    sorted.forEach(function (m) {
      m = fitRange(m, tuning[0], tuning[tuning.length - 1] + 12);
      for (var s = used + 1; s < tuning.length; s++) {
        var f = m - tuning[s];
        if (f >= 0 && f <= 12) { out.push({ s:s, fret:f }); used = s; return; }
      }
    });
    return out;
  }

  /* ---------- 音符（秒単位）→ エンジンのイベント ----------
     items: [{ t:開始秒, d:長さ秒, notes:[MIDI...], v:0〜1, dir:1|-1, strum:秒（和音を鳴らす間隔） }] */
  function keysEvents(items) {
    var ev = [];
    items.forEach(function (n) {
      var d = Math.max(.03, n.d), gap = n.strum === undefined ? .004 : n.strum;
      var ns = n.dir < 0 ? n.notes.slice().reverse() : n.notes;
      ns.forEach(function (m, i) {
        ev.push({ kind:"on", note:m, vel:Math.max(.02, Math.min(1, n.v)), t:n.t + i * gap });
        ev.push({ kind:"off", note:m, t:n.t + d });
      });
    });
    return ev;
  }
  function stringEvents(items, snd) {
    var bass = snd.kind === "bass", tuning = bass ? BT : GT, ev = [], last = null, tech = snd.tech || (bass ? "finger" : "pick");
    items.forEach(function (n) {
      var d = Math.max(.04, n.d), v = Math.max(.02, Math.min(1, n.v));
      if (n.notes.length > 1 && !snd.mono && !bass) {
        /* ストローク：ダウンは低い弦から、アップは高い弦から */
        var pl = placeChord(n.notes, tuning), gap = n.strum === undefined ? .011 : n.strum;
        if (n.dir < 0) pl.reverse();
        pl.forEach(function (p, i) {
          ev.push({ s:p.s, fret:p.fret, tech:n.tech || "pick", vel:v * (1 - i * .03), pos:.2, t:n.t + i * gap });
          ev.push({ kind:"damp", s:p.s, dur:.025, t:n.t + d });
        });
        return;
      }
      var m = bass ? fitRange(Math.min.apply(null, n.notes), 28, 55) : fitRange(Math.min.apply(null, n.notes), 40, 84);
      var p = placeMono(m, tuning, last, bass ? 12 : 17);
      if (!p) return;
      if (last && last.s !== p.s) ev.push({ kind:"damp", s:last.s, dur:.05, t:n.t });
      var tq = n.tech || (tech === "slap" && p.s >= 2 ? "pop" : tech);
      ev.push({ s:p.s, fret:p.fret, tech:tq, vel:v, pos:bass ? .16 : .18, t:n.t });
      ev.push({ kind:"damp", s:p.s, dur:.025, t:n.t + d });
      last = p;
    });
    return ev;
  }
  /* ドラム：名前（kick, snare…）か GM の音番号（36 など）で叩く場所を決める */
  var DRUMMAP = { kick:{ p:"kick", pos:.15 }, snare:{ p:"snare", pos:.3 }, rim:{ p:"snare", art:"rim", pos:.3 }, side:{ p:"snare", art:"side" },
    hat:{ p:"hat", art:"closed", pos:.7 }, open:{ p:"hat", art:"open", pos:.7 }, pedal:{ p:"hat", art:"pedal" },
    ride:{ p:"ride", art:"bow", pos:.62 }, bell:{ p:"ride", art:"bell", pos:.1 }, crash:{ p:"crash", pos:.8 },
    tomH:{ p:"tomH", pos:.35 }, tomM:{ p:"tomM", pos:.35 }, tomL:{ p:"floor", pos:.35 } };
  var GM = { 35:"kick", 36:"kick", 37:"side", 38:"snare", 40:"snare", 39:"snare", 42:"hat", 44:"pedal", 46:"open", 41:"tomL", 43:"tomL",
    45:"tomM", 47:"tomM", 48:"tomH", 50:"tomH", 49:"crash", 52:"crash", 55:"crash", 57:"crash", 51:"ride", 59:"ride", 53:"bell" };
  function drumKind(x) { return typeof x === "number" ? GM[x] || "hat" : DRUMMAP[x] ? x : "hat"; }
  /* items: [{ t:秒, kind:名前 or 音番号, v:0〜1, pos?, art? }] */
  function drumEvents(items, kitId) {
    var kit = INS.kit(kitId), map = kit.map || {}, kv = kit.vel || {};
    return items.map(function (d) {
      if (d.kind === "choke") return { kind:"choke", p:d.p || "crash", t:d.t };
      /* p を直接書いた打撃は、キットの置き換えをせずにそのまま叩く */
      if (d.p) return { p:d.p, art:d.art, pos:d.pos, vel:Math.max(.02, Math.min(1, d.v)), t:d.t };
      var k = drumKind(d.kind), r = map[k] || DRUMMAP[k];
      return { p:r.p, art:d.art || r.art, pos:d.pos === undefined ? r.pos : d.pos, vel:Math.max(.02, Math.min(1, d.v * (kv[k] || 1))), t:d.t };
    });
  }

  /* ---------- 響き（インパルス応答。左右2本の Float32Array） ---------- */
  function rng(seed) { var s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  function modesIR(sr, modes, sec, norm) {
    var len = Math.floor(sr * sec), out = [new Float32Array(len), new Float32Array(len)];
    for (var c = 0; c < 2; c++) {
      var d = out[c];
      modes.forEach(function (m) {
        var w = 2 * Math.PI * m[0] * (1 + c * .004) / sr, dec = Math.exp(-Math.PI * m[0] / m[2] / sr), env = m[1], ph = m[3] || 0;
        for (var i = 0; i < len; i++) { d[i] += env * Math.sin(w * i + ph); env *= dec; if (env < 1e-5) break; }
      });
      var e = 0, i;
      for (i = 0; i < len; i++) e += d[i] * d[i];
      var k = norm / Math.sqrt(e || 1);
      for (i = 0; i < len; i++) d[i] *= k;
    }
    return out;
  }
  function cabIR(sr, main, fLo, span, fHi, sec) {
    var R = rng(11), modes = main.slice();
    for (var i = 0; i < 60; i++) { var f = fLo * Math.exp(R() * Math.log(span)); modes.push([f, .35 * R() / (1 + Math.pow(f / fHi, 4)), 8 + R() * 12, R() * 6.283]); }
    return modesIR(sr, modes, sec, 1.1);
  }
  function irs(sr) {
    var R = rng(7), body = [[100, 1, 14], [190, .95, 20], [232, .5, 22], [385, .6, 25], [440, .42, 25], [560, .45, 28], [680, .32, 30], [840, .3, 30], [1000, .26, 30]], i, f;
    for (i = 0; i < 130; i++) { f = 1100 * Math.exp(R() * Math.log(7000 / 1100)); body.push([f, .26 * R() / (1 + Math.pow(f / 2800, 2)), 25 + R() * 25, R() * 6.283]); }
    var R2 = rng(99), board = [];
    for (i = 0; i < 220; i++) { f = 50 * Math.exp(R2() * Math.log(9000 / 50)); board.push([f, (.4 + R2()) / (1 + Math.pow(f / 2500, 2)), 12 + R2() * 30, R2() * 6.283]); }
    return { body:modesIR(sr, body, .32, 1.6), board:modesIR(sr, board, .45, 1.5),
      gcab:cabIR(sr, [[110, 1, 3], [1250, .5, 4], [2600, .65, 5], [3900, .3, 6]], 180, 30, 3600, .05),
      bcab:cabIR(sr, [[62, 1, 2.2], [150, .55, 3], [750, .3, 4], [2100, .38, 5], [3300, .18, 6]], 90, 45, 3000, .07) };
  }
  function reverbIR(sr, sec) {
    var n = Math.floor(sr * sec), R = rng(5), out = [new Float32Array(n), new Float32Array(n)];
    for (var c = 0; c < 2; c++) {
      var d = out[c], lp = 0;
      for (var i = 0; i < n; i++) { var t = i / n; lp += (R() * 2 - 1 - lp) * (.5 - .42 * t); d[i] = lp * Math.pow(1 - t, 2.8) * (i < sr * .015 ? i / (sr * .015) : 1); }
    }
    return out;
  }
  /* エレキの歪み（アンプ）の曲線 */
  function driveCurve(d) {
    var kk = 1 + d * 14, n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(kk * x + .12 * d) / Math.tanh(kk); }
    return c;
  }

  /* AudioWorklet に渡すソース（3つのエンジン＋パート1台ぶんの処理） */
  function workletSource() {
    var D = root.physDsp, src = "";
    [["guitar", "GuitarDSP"], ["drum", "DrumDSP"], ["keys", "KeysDSP"]].forEach(function (x) { src += "const " + x[1] + "=(" + D[x[0]].toString() + ")();\n"; });
    return src + "class UsPart extends AudioWorkletProcessor{constructor(o){super();const po=o.processorOptions;" +
      "const C=po.engine==='guitar'?GuitarDSP:po.engine==='drum'?DrumDSP:KeysDSP;this.d=new C(sampleRate);this.on=true;" +
      "po.init.forEach(m=>this.d.handle(m));this.d.handle({type:'ev',list:po.events});this.port.onmessage=e=>{if(e.data==='stop')this.on=false;};}" +
      "process(i,o){if(!this.on)return false;const L=o[0][0],R=o[0][1]||L;this.d.render(L,R,L.length,currentFrame);return true;}}\n" +
      "registerProcessor('us-part',UsPart);";
  }

  root.core = { GT:GT, BT:BT, strParams:strParams, strProfile:strProfile, engineOf:engineOf, keysEvents:keysEvents, stringEvents:stringEvents,
    drumEvents:drumEvents, drumKind:drumKind, DRUMMAP:DRUMMAP, GM:GM, irs:irs, reverbIR:reverbIR, driveCurve:driveCurve, workletSource:workletSource };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
