/* export.js — 保存：MIDI（全パート・歌詞つき）、WAV（物理モデル音源で書き出し）、プロジェクト（JSON）。
   MusicXML は musicxml.js。 */
(function (root) {
  "use strict";
  var INS = root.instruments;

  /* ---------- MIDI ---------- */
  function vlq(v) { var n = Math.max(0, Math.round(v)), o = [n & 0x7f]; n >>= 7; while (n > 0) { o.unshift((n & 0x7f) | 0x80); n >>= 7; } return o; }
  function bytes(text) { return Array.prototype.slice.call(new TextEncoder().encode(String(text))); }
  function chunk(events) {
    events.sort(function (a, b) { return a.t - b.t || a.o - b.o; });
    var last = 0, body = [];
    events.forEach(function (e) { body = body.concat(vlq(e.t - last), e.d); last = e.t; });
    body = body.concat([0, 0xff, 0x2f, 0]);
    var n = body.length;
    return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].concat(body);
  }
  var PPQ = 480, TPS = PPQ / 4; /* 16分＝120tick */
  function track(name, ch, program, notes) {
    var ev = [], nm = bytes(name);
    ev.push({ t:0, o:-3, d:[0xff, 0x03].concat(vlq(nm.length), nm) });
    if (ch !== 9) ev.push({ t:0, o:-2, d:[0xc0 | ch, program & 127] });
    notes.forEach(function (n) {
      var s = Math.round(n.s * TPS), e = Math.max(s + 1, Math.round((n.s + (n.d || .5)) * TPS)), v = Math.max(1, Math.min(127, Math.round(n.v || 96)));
      if (n.text) { var ly = bytes(n.text); ev.push({ t:s, o:-1, d:[0xff, 0x05].concat(vlq(ly.length), ly) }); }
      ev.push({ t:s, o:1, d:[0x90 | ch, n.n & 127, v] });
      ev.push({ t:e, o:0, d:[0x80 | ch, n.n & 127, 0] });
    });
    return chunk(ev);
  }
  var DRUM_NOTE = { kick:36, snare:38, side:37, hat:42, open:46, pedal:44, ride:51, bell:53, crash:49, tomH:50, tomM:47, tomL:43 };
  function midi(song) {
    var P = song.parts || {}, ins = song.instruments, us = Math.round(60000000 / song.bpm);
    var meta = chunk([{ t:0, o:0, d:[0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { t:0, o:1, d:[0xff, 0x58, 4, 4, 2, 24, 8] }]);
    var flat = function (list) { var out = []; (list || []).forEach(function (c) { (c.chord || [c.n]).forEach(function (m) { out.push({ s:c.s, d:c.d, n:m, v:c.v }); }); }); return out; };
    var tracks = [meta,
      track("Melody", 0, INS.byId(ins.melody).program, song.melody),
      track("Intro Hook", 3, INS.byId(ins.melody).program, P.lead || []),

      track("Bass", 2, INS.byId(ins.bass).program, P.bass || []),
      track("Drums", 9, 0, (P.drums || []).map(function (d) { return { s:d.s, d:.5, n:DRUM_NOTE[d.kind] || 42, v:d.v }; }))];
    /* 和音の層は1層ずつ別トラック（チャンネル 4,5,6… ドラムの10chは避ける） */
    (P.layers || []).forEach(function (l, i) { var ch = [1, 4, 5, 6, 7, 8, 10, 11][i] || 12; tracks.push(track("Chords " + (i + 1) + " (" + INS.byId(l.ins).name + ")", ch, INS.byId(l.ins).program, flat(l.notes))); });
    if (P.answer) tracks.push(track("Answer (" + INS.byId(P.answer.ins).name + ")", 13, INS.byId(P.answer.ins).program, P.answer.notes));
    var head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array(head.concat.apply(head, tracks));
  }

  /* 自由スコア → MIDI（トラックごと。テンポ変化・歌詞も入れる） */
  var GM_OF = { kick:36, snare:38, rim:37, side:37, hat:42, open:46, pedal:44, ride:51, bell:53, crash:49, tomH:50, tomM:47, tomL:43 };
  function scoreMidi(sc) {
    var TPB = PPQ, meta = [];
    sc.tempo.list.forEach(function (x) { var us = Math.round(60000000 / x.bpm); meta.push({ t:Math.round(x.at * TPB), o:0, d:[0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }); });
    var num = sc.timeSignature[0] || 4, den = sc.timeSignature[1] || 4;
    meta.push({ t:0, o:1, d:[0xff, 0x58, 4, num & 255, Math.round(Math.log(den) / Math.LN2) & 255, 24, 8] });
    var tracks = [chunk(meta)], ch = 0;
    sc.tracks.forEach(function (tr) {
      var notes = [], channel;
      if (tr.drums) { channel = 9; tr.hits.forEach(function (h) { notes.push({ s:h.beat * 4, d:.5, n:typeof h.kind === "number" ? h.kind : GM_OF[h.kind] || 42, v:h.v * 127 }); }); }
      else {
        channel = ch === 9 ? ++ch : ch; ch++;
        tr.notes.forEach(function (n) { n.notes.forEach(function (m, i) { notes.push({ s:n.beat * 4, d:n.len * 4, n:m, v:n.v * 127, text:i === 0 ? n.lyric : "" }); }); });
      }
      var it = INS.LIST.filter(function (x) { return x.id === tr.instrument; })[0];
      tracks.push(track(tr.name, Math.min(15, channel), it ? it.program : 81, notes));
    });
    var head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
    return new Uint8Array(head.concat.apply(head, tracks));
  }
  /* L/R の Float32Array から WAV を作る（ターミナル用） */
  function wavFromChannels(L, R, sr) {
    return wav({ numberOfChannels:2, sampleRate:sr, getChannelData:function (c) { return c ? R : L; } });
  }

  /* ---------- WAV（16bit ステレオ） ---------- */
  function wav(buffer) {
    var ch = [buffer.getChannelData(0), buffer.getChannelData(buffer.numberOfChannels > 1 ? 1 : 0)], n = ch[0].length, sr = buffer.sampleRate;
    var peak = 0, i;
    for (i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ch[0][i]), Math.abs(ch[1][i]));
    var g = peak > .98 ? .98 / peak : 1, out = new DataView(new ArrayBuffer(44 + n * 4));
    var w = function (o, s) { for (var k = 0; k < s.length; k++) out.setUint8(o + k, s.charCodeAt(k)); };
    w(0, "RIFF"); out.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt ");
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, sr, true);
    out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, n * 4, true);
    for (i = 0; i < n; i++) for (var c = 0; c < 2; c++) {
      var v = Math.max(-1, Math.min(1, ch[c][i] * g));
      out.setInt16(44 + i * 4 + c * 2, v < 0 ? v * 32768 : v * 32767, true);
    }
    return new Uint8Array(out.buffer);
  }

  /* ---------- プロジェクト ---------- */
  var FORMAT = "uta-studio-2/project", VERSION = 1;
  function project(state) { return JSON.stringify({ format:FORMAT, version:VERSION, savedAt:new Date().toISOString(), state:state }, null, 1); }
  function readProject(text) {
    var data = JSON.parse(text);
    if (!data || data.format !== FORMAT || !data.state || typeof data.state.lyrics !== "string") throw new Error("歌スタジオ 2 のプロジェクトではありません");
    return data.state;
  }

  root.exporter = { midi:midi, scoreMidi:scoreMidi, wav:wav, wavFromChannels:wavFromChannels, project:project, readProject:readProject };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
