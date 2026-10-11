/* engine/player.js — ブラウザで鳴らす（再生とWAV書き出し）。
   入力は2種類：アプリが作った曲（compose＋arrange の結果）と、自由スコア（score.js）。
   どちらもいったん「パート（エンジン1台ぶん）＋秒単位のイベント」にしてから、
   パートごとに AudioWorklet を1台立てる。音符はすべて最初に渡すので、再生と書き出しは同じ音になる。
   音符→イベント、響きのインパルス応答は core.js（ターミナル版の mixer.js と共通）。 */
(function (root) {
  "use strict";
  var INS = root.instruments, C = root.core, SPB = 16;

  /* ---------- アプリの曲 → パート ---------- */
  function vel(n) { return n && n.v !== undefined ? Math.max(.05, Math.min(1, n.v / 127)) : .78; }
  function buildParts(song, opts) {
    var spb = 60 / song.bpm / 4, lead = (opts && opts.leadSteps) || 0, mute = (opts && opts.mute) || {};
    var toSec = function (s) { return (s + lead) * spb; }, parts = [], ins = song.instruments || {}, P = song.parts || {}, mix = song.mix || {};
    function add(part, snd, notes, lenK, gain) {
      if (!snd || !notes || !notes.length || mute[part]) return;
      var items = notes.map(function (n) { return { t:toSec(n.s), d:n.d * spb * lenK, notes:n.chord || [n.n], v:vel(n), dir:n.dir }; });
      parts.push({ part:part, snd:snd, events:snd.kind === "keys" ? C.keysEvents(items) : C.stringEvents(items, snd), gain:gain !== undefined ? gain : mix[part] || 1 });
    }
    add("melody", INS.byId(ins.melody).melody, song.melody, .94);
    add("melody", INS.byId(ins.melody).melody, P.lead, .94);
    (P.layers || []).forEach(function (l) { add("comp", INS.byId(l.ins).compSound, l.notes, .96, l.gain); });
    /* 掛け合い（歌の合間に答える短いフレーズ）は、その楽器の旋律用の音で */
    if (P.answer && P.answer.notes.length) add("comp", INS.byId(P.answer.ins).melody, P.answer.notes, .92, (mix.melody || 1) * .7);
    add("bass", INS.byId(ins.bass).bassSound, P.bass, .92);
    if (P.drums && P.drums.length && !mute.drums) {
      var hits = P.drums.map(function (d) { return { t:toSec(d.s), kind:d.kind, v:vel(d) }; });
      parts.push({ part:"drums", snd:{ kind:"drum", trim:2 }, events:C.drumEvents(hits, ins.kit), gain:mix.drums || 1 });
    }
    return parts;
  }
  function isScore(x) { return x && x.format === root.score.FORMAT; }

  /* ---------- Web Audio の組み立て ---------- */
  function toBuffer(ctx, pair) { var b = ctx.createBuffer(2, pair[0].length, ctx.sampleRate); b.getChannelData(0).set(pair[0]); b.getChannelData(1).set(pair[1]); return b; }
  var moduleUrl = null;
  function loadModule(ctx) {
    if (!ctx.audioWorklet) return Promise.reject(new Error("このブラウザは AudioWorklet に対応していません"));
    if (!moduleUrl) moduleUrl = URL.createObjectURL(new Blob([C.workletSource()], { type:"application/javascript" }));
    return ctx.audioWorklet.addModule(moduleUrl);
  }
  function graph(ctx, volumes, master) {
    var g = { master:ctx.createGain(), parts:{} }, comp = ctx.createDynamicsCompressor(), lim = ctx.createDynamicsCompressor(), rev = ctx.createConvolver(), wet = ctx.createGain();
    g.master.gain.value = master && master.volume !== undefined ? master.volume : volumes.master;
    ["melody", "comp", "bass", "drums"].forEach(function (p) { g.parts[p] = ctx.createGain(); g.parts[p].gain.value = volumes[p]; g.parts[p].connect(g.master); });
    comp.threshold.value = -16; comp.ratio.value = 2.5; comp.attack.value = .015; comp.release.value = .2; comp.knee.value = 8;
    lim.threshold.value = -3; lim.ratio.value = 20; lim.attack.value = .002; lim.release.value = .1; lim.knee.value = 0;
    rev.buffer = toBuffer(ctx, C.reverbIR(ctx.sampleRate, 2.2)); wet.gain.value = master && master.reverb !== undefined ? master.reverb : .16;
    g.master.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    g.master.connect(rev); rev.connect(wet); wet.connect(ctx.destination);
    var ir = C.irs(ctx.sampleRate);
    g.irs = { body:toBuffer(ctx, ir.body), board:toBuffer(ctx, ir.board), gcab:toBuffer(ctx, ir.gcab), bcab:toBuffer(ctx, ir.bcab) };
    return g;
  }
  /* エンジン1台と、その後ろの響き（ボディ／アンプとキャビネット／響板／コーラス／パン） */
  function buildPart(ctx, part, dest, irs, offset) {
    var snd = part.snd, G = function (v) { var g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; return g; };
    var events = part.events.map(function (e) { var c = {}, k; for (k in e) c[k] = e[k]; c.t = e.t + offset; return c; });
    var eng = C.engineOf(snd);
    var node = new AudioWorkletNode(ctx, "us-part", { numberOfInputs:0, outputChannelCount:[2], processorOptions:{ engine:eng.engine, init:eng.init, events:events } });
    var out = G((snd.trim || 1) * (part.gain === undefined ? 1 : part.gain)), sp = (snd.kind === "gtr" || snd.kind === "bass" ? C.strProfile(snd) : {});
    if (snd.kind === "gtr" && sp.mode === "acoustic") {
      var dry = G(.12 + .5 * (1 - sp.body)), wet = G(sp.body), body = ctx.createConvolver();
      body.normalize = false; body.buffer = irs.body;
      node.connect(dry).connect(out); node.connect(body).connect(wet).connect(out);
    } else if (snd.kind === "gtr" || snd.kind === "bass") {
      var bass = snd.kind === "bass", d = bass ? 0 : sp.drive || 0, pre = G(1 + d * 5), sh = ctx.createWaveShaper(), post = G(1 / (1 + d * 2.2));
      if (d > .01) { sh.curve = C.driveCurve(d); sh.oversample = "4x"; }
      var cab = ctx.createConvolver(), cd = G(bass ? .15 : .12), amp = G(1);
      cab.normalize = false; cab.buffer = bass ? irs.bcab : irs.gcab;
      node.connect(pre).connect(sh).connect(post);
      post.connect(cd).connect(amp); post.connect(cab).connect(amp);
      if (bass) {
        var cp = ctx.createDynamicsCompressor();
        cp.threshold.value = -24; cp.ratio.value = 4; cp.attack.value = .01; cp.release.value = .2;
        amp.connect(cp).connect(out);
      } else amp.connect(out);
    } else if (snd.board) {
      var bd = G(.35 + .4 * (1 - snd.board)), bw = G(snd.board * .9), bc = ctx.createConvolver();
      bc.normalize = false; bc.buffer = irs.board;
      node.connect(bd).connect(out); node.connect(bc).connect(bw).connect(out);
    } else node.connect(out);
    var last = out;
    if (snd.chorus) {
      var mixG = G(1), dryC = G(1 - snd.chorus * .3), wetC = G(snd.chorus * .7), d1 = ctx.createDelay(.05), d2 = ctx.createDelay(.05);
      var lfo = ctx.createOscillator(), l1 = G(.0025), l2 = G(-.0025);
      d1.delayTime.value = .012; d2.delayTime.value = .017; lfo.frequency.value = .6;
      lfo.connect(l1).connect(d1.delayTime); lfo.connect(l2).connect(d2.delayTime); lfo.start();
      out.connect(dryC).connect(mixG); out.connect(d1).connect(wetC); out.connect(d2).connect(wetC); wetC.connect(mixG);
      last = mixG;
    }
    if (part.pan) { var pn = ctx.createStereoPanner(); pn.pan.value = part.pan; last.connect(pn); last = pn; }
    last.connect(dest);
    return node;
  }

  /* ---------- 再生・書き出し ---------- */
  var ctx = null, g = null, ready = null, nodes = [], timer = null, playing = false;
  var volumes = { master:.75, melody:1, comp:1, bass:1, drums:1 };
  function ensure() {
    if (ready) return ready;
    var AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint:"playback" });
    g = graph(ctx, volumes);
    ready = loadModule(ctx);
    return ready;
  }
  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    nodes.forEach(function (n) { try { n.port.postMessage("stop"); n.disconnect(); } catch (e) { /* 停止済み */ } });
    nodes = [];
  }
  /* 再生。アプリの曲は fromStep（16分）から、自由スコアは fromBeat（拍）から。onStep(位置) は 16分単位で返す */
  function play(input, opts) {
    var o = opts || {};
    stop();
    return ensure().then(function () {
      if (ctx.state === "suspended") ctx.resume();
      var startAt = ctx.currentTime + .15, parts, toStep, end;
      if (isScore(input)) {
        var fromBeat = o.fromStep ? o.fromStep / 4 : 0, t0 = input.tempo.sec(fromBeat);
        parts = root.score.parts(input, { fromBeat:fromBeat, mute:o.mute });
        toStep = function (t) { return input.tempo.beat(t0 + t) * 4; };
        end = input.lengthBeats * 4 + 8;
        g.master.gain.value = input.master.volume;
      } else {
        var spb = 60 / input.bpm / 4, from = Math.max(0, o.fromStep || 0);
        parts = buildParts(input, { mute:o.mute });
        /* 途中から再生：始める位置より前の音は鳴らさない（まとめて鳴ってしまうため） */
        parts.forEach(function (p) { p.events.forEach(function (e) { e.t -= from * spb; }); p.events = p.events.filter(function (e) { return e.t >= -.001; }); });
        toStep = function (t) { return from + t / spb; };
        end = (input.totalSteps || 0) + 8;
        g.master.gain.value = volumes.master;
      }
      nodes = parts.map(function (p) { return buildPart(ctx, p, g.parts[p.part] || g.master, g.irs, startAt); });
      playing = true;
      timer = setInterval(function () {
        if (!playing) return;
        var step = toStep(Math.max(0, ctx.currentTime - startAt));
        if (o.onStep) o.onStep(step);
        if (step > end) { stop(); if (o.onEnd) o.onEnd(); }
      }, 30);
    });
  }
  function render(input, opts) {
    var o = opts || {}, OC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = o.sampleRate || 44100, parts, seconds, master;
    if (isScore(input)) { parts = root.score.parts(input, { mute:o.mute }); seconds = input.seconds; master = input.master; }
    else {
      var spb = 60 / input.bpm / 4;
      parts = buildParts(input, { mute:o.mute, leadSteps:o.leadSteps });
      seconds = ((input.totalSteps || 0) + (o.leadSteps || 0)) * spb;
    }
    seconds += o.tail === undefined ? 3 : o.tail;
    var off = new OC(2, Math.ceil(seconds * sr), sr);
    return loadModule(off).then(function () {
      var og = graph(off, volumes, master);
      parts.forEach(function (p) { buildPart(off, p, og.parts[p.part] || og.master, og.irs, 0); });
      return off.startRendering();
    });
  }
  function setVolume(part, v) {
    if (!(part in volumes)) return;
    volumes[part] = Math.max(0, Math.min(1.5, +v || 0));
    if (g) (part === "master" ? g.master : g.parts[part]).gain.value = volumes[part];
  }

  root.player = { play:play, stop:stop, render:render, setVolume:setVolume, isPlaying:function () { return playing; }, buildParts:buildParts, ensure:ensure };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
