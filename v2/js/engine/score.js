/* engine/score.js — 自由スコア（uta-studio-2/score）。テンプレートを使わず、1音ずつ書いた曲をそのまま鳴らす形式。
   ・トラックは何本でも。各トラックに楽器（楽器表のID、または音源の生の設定）を1つ
   ・時間は「拍」（4分音符＝1）。小数で自由に置ける（3連・スウィング・ずらしも可）
   ・テンポ変化、拍子、パン、音量、歌詞（任意）
   ・ドラムは1打ずつ（名前か GM の音番号）
   書式の説明は AGENTS.md。このファイルは「読む」「秒に直す」「エンジンのイベントにする」だけを行う。 */
(function (root) {
  "use strict";
  var T = root.theory, INS = root.instruments, C = root.core;
  var FORMAT = "uta-studio-2/score";

  function fail(msg) { throw new Error(msg); }
  var PC = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  function noteNum(v, where) {
    if (typeof v === "number" && v >= 0 && v <= 127) return Math.round(v);
    var m = String(v).trim().match(/^([A-Ga-g])([#♯b♭]?)(-?\d)$/);
    if (!m) fail(where + "の音「" + v + "」が読めません（例：C4・F#3・Bb5・60）");
    var acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
    return Math.max(0, Math.min(127, (+m[3] + 1) * 12 + PC[m[1].toUpperCase()] + acc));
  }
  /* "Cmaj7" のような記号は、octave（既定3）から上に積む。配列なら音を直接 */
  function chordNotes(n, where) {
    if (Array.isArray(n.chord)) return n.chord.map(function (x, i) { return noteNum(x, where + ".chord[" + i + "]"); });
    var c = root.blueprint.parseChord(n.chord, where);
    var base = ((n.octave === undefined ? 3 : +n.octave) + 1) * 12;
    var v = T.chordVoicing(c, base);
    if (Number.isFinite(c.bass)) { var b = base - 12 + c.bass; while (b >= v[0]) b -= 12; v.unshift(b); }
    return v;
  }
  function vel(v, def) {
    if (v === undefined || v === null) return def;
    v = +v;
    return v > 1 ? Math.max(.02, Math.min(1, v / 127)) : Math.max(.02, Math.min(1, v));
  }

  /* テンポ：拍 → 秒。tempo: [{at:拍, bpm}]（段階的に変わる）または bpm 1つ */
  function tempoMap(s) {
    var list = Array.isArray(s.tempo) && s.tempo.length ? s.tempo.map(function (x) { return { at:Math.max(0, +x.at || 0), bpm:Math.max(20, Math.min(300, +x.bpm || 120)) }; })
      : [{ at:0, bpm:Math.max(20, Math.min(300, +s.bpm || 120)) }];
    list.sort(function (a, b) { return a.at - b.at; });
    if (list[0].at > 0) list.unshift({ at:0, bpm:list[0].bpm });
    var acc = 0;
    list.forEach(function (x, i) { x.sec = acc; if (list[i + 1]) acc += (list[i + 1].at - x.at) * 60 / x.bpm; });
    function sec(beat) {
      var x = list[0];
      for (var i = 1; i < list.length && list[i].at <= beat; i++) x = list[i];
      return x.sec + (beat - x.at) * 60 / x.bpm;
    }
    function beat(t) {
      var x = list[0];
      for (var i = 1; i < list.length && list[i].sec <= t; i++) x = list[i];
      return x.at + (t - x.sec) * x.bpm / 60;
    }
    return { sec:sec, beat:beat, list:list };
  }

  /* トラックの音：instrument（楽器表のID）＋ sound（melody / comp / bass）＋ patch（設定の上書き）、
     または engine に生の設定（{kind:"keys", p:{…}} / {kind:"gtr"|"bass", str:"steel", mono, tech}） */
  function soundOf(tr, where) {
    var snd;
    if (tr.engine) {
      var e = tr.engine;
      if (e.kind === "keys") snd = { kind:"keys", p:Object.assign({ instr:"synth" }, e.p || {}), trim:e.trim || 1, chorus:e.chorus, board:e.board };
      else if (e.kind === "gtr" || e.kind === "bass") snd = { kind:e.kind, str:INS.STRINGS[e.str] ? e.str : e.kind === "bass" ? "bfinger" : "steel", mono:!!e.mono, tech:e.tech, trim:e.trim || (e.kind === "bass" ? .42 : .2), set:e.set || null, chorus:e.chorus };
      else fail(where + " の engine.kind は keys / gtr / bass のどれかにしてください");
    } else {
      var it = INS.LIST.filter(function (x) { return x.id === tr.instrument; })[0];
      if (!it) fail(where + " の instrument「" + tr.instrument + "」は楽器表にありません（node tools/render.mjs --list で一覧）");
      var role = tr.sound || (it.bassSound && !it.melody ? "bass" : "melody");
      var base = role === "bass" ? it.bassSound : role === "comp" ? it.compSound : it.melody;
      if (!base) fail(where + " の楽器「" + it.id + "」には sound「" + role + "」がありません");
      snd = Object.assign({}, base);
      if (tr.patch && snd.kind === "keys") snd.p = Object.assign({}, snd.p, tr.patch);
    }
    if (tr.reverbless) snd.dry = true;
    return snd;
  }

  /** JSON（文字列かオブジェクト）→ 正規化したスコア */
  function read(input) {
    var s = typeof input === "string" ? JSON.parse(String(input).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")) : input;
    if (!s || s.format !== FORMAT) fail("format が \"" + FORMAT + "\" ではありません");
    if (!Array.isArray(s.tracks) || !s.tracks.length) fail("tracks がありません");
    var tm = tempoMap(s), ts = Array.isArray(s.timeSignature) ? s.timeSignature : [4, 4], beatsPerBar = Math.max(1, +ts[0] || 4) * 4 / Math.max(1, +ts[1] || 4);
    var tracks = s.tracks.map(function (tr, i) {
      var where = "tracks[" + i + "]" + (tr.name ? "（" + tr.name + "）" : "");
      var out = { name:String(tr.name || ("Track " + (i + 1))), volume:Math.max(0, Math.min(2, tr.volume === undefined ? 1 : +tr.volume)),
        pan:Math.max(-1, Math.min(1, +tr.pan || 0)), lead:!!tr.lead, gate:tr.gate === undefined ? .96 : Math.max(.1, Math.min(1, +tr.gate)) };
      if (tr.drums) {
        out.drums = true; out.kit = tr.kit || "standard";
        out.hits = (tr.hits || []).map(function (h, j) {
          if (!Number.isFinite(+h.t)) fail(where + ".hits[" + j + "] の t（拍）がありません");
          /* p（打つ物：kick snare hat ride crash tomH tomM floor）を直接書くと、キットの置き換えをしない。kind:"choke" はシンバルを手で止める */
          return { beat:+h.t, kind:h.kind !== undefined ? h.kind : h.n !== undefined ? +h.n : "hat", p:h.p, v:vel(h.v, .8), art:h.art, pos:h.pos };
        });
        return out;
      }
      out.snd = soundOf(tr, where);
      out.instrument = tr.instrument || (tr.engine && tr.engine.kind) || "custom";
      out.notes = (tr.notes || []).map(function (n, j) {
        var w = where + ".notes[" + j + "]";
        if (!Number.isFinite(+n.t)) fail(w + " の t（拍）がありません");
        /* 弦楽器は string（0＝いちばん低い弦）と fret で、押さえる場所を直接決められる（d は省略可＝鳴らしっぱなし） */
        if (n.string !== undefined) {
          if (!Number.isFinite(+n.fret)) fail(w + " の fret がありません");
          return { beat:+n.t, len:+n.d > 0 ? +n.d : 0, notes:[], string:+n.string, fret:+n.fret, pos:n.pos, v:vel(n.v, .8), tech:n.tech, lyric:"" };
        }
        if (!(+n.d > 0)) fail(w + " の d（長さ・拍）が変です");
        var notes = n.chord !== undefined ? chordNotes(n, w) : [noteNum(n.n, w)];
        return { beat:+n.t, len:+n.d, notes:notes, v:vel(n.v, .78), dir:n.dir < 0 ? -1 : 1, strum:n.strum, tech:n.tech, lyric:n.lyric ? String(n.lyric) : "" };
      }).sort(function (a, b) { return a.beat - b.beat; });
      /* events：音源へそのまま渡す演奏操作（拍）。チョーキング・スライド・ビブラート・ミュート・ペダル・うねり など */
      out.events = (tr.events || []).map(function (e, j) {
        if (!Number.isFinite(+e.t)) fail(where + ".events[" + j + "] の t（拍）がありません");
        var c = {}, k; for (k in e) if (k !== "t") c[k] = e[k];
        return { beat:+e.t, ev:c };
      });
      return out;
    });
    var end = 0;
    tracks.forEach(function (t) {
      (t.notes || []).forEach(function (n) { end = Math.max(end, n.beat + Math.max(n.len, .5)); });
      (t.events || []).forEach(function (e) { end = Math.max(end, e.beat + .5); });
      (t.hits || []).forEach(function (h) { end = Math.max(end, h.beat + .5); });
    });
    var lengthBeats = Math.max(end, +s.length || 0);
    return { format:FORMAT, title:String(s.title || "無題"), tempo:tm, bpm:tm.list[0].bpm, beatsPerBar:beatsPerBar, timeSignature:ts,
      lengthBeats:lengthBeats, seconds:tm.sec(lengthBeats), tracks:tracks,
      sections:(Array.isArray(s.sections) ? s.sections : []).map(function (x) { return { name:String(x.name || ""), at:+x.at || 0 }; }),
      master:{ volume:s.master && s.master.volume !== undefined ? +s.master.volume : .75, reverb:s.master && s.master.reverb !== undefined ? +s.master.reverb : .16 } };
  }

  /** スコア → パート（エンジン1台ぶん）のリスト。from（拍）より前は鳴らさない */
  function parts(sc, opts) {
    var o = opts || {}, from = o.fromBeat || 0, t0 = sc.tempo.sec(from), out = [];
    sc.tracks.forEach(function (tr, i) {
      if (o.mute && o.mute[i]) return;
      var g = tr.volume;
      if (tr.drums) {
        var hits = tr.hits.filter(function (h) { return h.beat >= from; }).map(function (h) { return { t:sc.tempo.sec(h.beat) - t0, kind:h.kind, p:h.p, v:h.v, art:h.art, pos:h.pos }; });
        if (hits.length) out.push({ part:"track" + i, name:tr.name, snd:{ kind:"drum", trim:2 }, events:C.drumEvents(hits, tr.kit), gain:g * .53, pan:tr.pan });
        return;
      }
      var live = tr.notes.filter(function (n) { return n.beat >= from - .001; }), bass = tr.snd.kind === "bass";
      var items = live.filter(function (n) { return n.string === undefined; }).map(function (n) {
        var a = sc.tempo.sec(n.beat) - t0, b = sc.tempo.sec(n.beat + n.len) - t0;
        return { t:a, d:(b - a) * tr.gate, notes:n.notes, v:n.v, dir:n.dir, strum:n.strum, tech:n.tech };
      });
      var ev = tr.snd.kind === "keys" ? C.keysEvents(items) : C.stringEvents(items, tr.snd);
      /* 弦とフレットを指定した音は、そのまま弾く */
      live.forEach(function (n) {
        if (n.string === undefined) return;
        var a = sc.tempo.sec(n.beat) - t0;
        ev.push({ s:n.string, fret:n.fret, tech:n.tech || (bass ? "finger" : "pick"), vel:n.v, pos:n.pos === undefined ? (bass ? .16 : .18) : n.pos, t:a });
        if (n.len > 0) ev.push({ kind:"damp", s:n.string, dur:.03, t:sc.tempo.sec(n.beat + n.len) - t0 });
      });
      tr.events.forEach(function (e) {
        if (e.beat < from - .001) return;
        var c = {}, k; for (k in e.ev) c[k] = e.ev[k]; c.t = sc.tempo.sec(e.beat) - t0; ev.push(c);
      });
      if (!ev.length) return;
      out.push({ part:"track" + i, name:tr.name, snd:tr.snd, events:ev, gain:g, pan:tr.pan });
    });
    return out;
  }

  root.score = { FORMAT:FORMAT, read:read, parts:parts, tempoMap:tempoMap, noteNum:noteNum };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
