/* compose.js — 歌詞から曲の骨組み（構成・小節ごとのコード・メロディ）を作る。
   1. 構成：前奏 → 歌詞のセクション（Aメロ／Bメロ／サビ…）→ 後奏 → 終止
   2. コード：セクションごとの進行を小節に並べる（最後は主和音で終わる）
   3. リズム：1音＝8分を基本に、言葉の終わりとフレーズの終わりをのばし、多い行は助詞を詰める
   4. 音高：サビは高め、強拍と長い音は和音の音、同じセクションの対の行は同じ形（A/A'）、
      対の1行目は途中で止まる音、2行目と曲の最後は主音へ着地
   同じ入力（歌詞・雰囲気・調・seed・案の種類）なら、必ず同じ曲になる。 */
(function (root) {
  "use strict";
  var T = root.theory, SPB = 16;

  function rng(seed) {
    var s = (Math.imul((seed >>> 0) || 1, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
    for (var i = 0; i < 6; i++) { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; }
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function pc(m) { return ((m % 12) + 12) % 12; }

  /* 案の種類：A＝素直、B＝ノリ（裏から入る・食う）、C＝サビ強め（跳躍と高さ） */
  var PROFILES = [
    { id:"natural", letter:"A", name:"素直", note:"言葉を追いやすい落ち着いた案", offset:[0, 0, 2], sync:.1, chorusLift:0, leap:.15 },
    { id:"groove", letter:"B", name:"ノリ", note:"裏拍から入って前へ進む案", offset:[2, 2, 1], sync:.45, chorusLift:1, leap:.22 },
    { id:"lift", letter:"C", name:"サビ強め", note:"サビで高く跳ねて山場を作る案", offset:[0, 2, 0], sync:.25, chorusLift:2, leap:.35 }
  ];

  function chordOf(key, c) {
    if (Number.isFinite(c.x)) return { root:pc(key.root + c.x), type:c.t || "maj" };
    return T.chordOfDegree(key, c.d, c.t);
  }

  /* ---------- リズム：1行 → [{dur, rest, mora}]（16分単位） ---------- */
  function rhythmFor(line, bars, offset, sync, R) {
    var ms = line.moras, notes = [];
    ms.forEach(function (m) {
      var last = notes[notes.length - 1];
      if (m.type === "long" && last) { last.dur += 2; last.text += "ー"; return; }
      if (m.type === "sokuon" && last) { last.dur = Math.max(1, last.dur - 1); last.rest += 1; last.text += "っ"; return; }
      notes.push({ dur:2, rest:0, text:m.text, wordEnd:!!m.wordEnd, phraseEnd:!!m.phraseEnd, particle:!!m.particle });
    });
    if (!notes.length) return { notes:[], offset:0 };
    var budget = bars * SPB - offset - 4; /* 最後の1拍は息つぎ */
    var used = function () { return notes.reduce(function (a, n) { return a + n.dur + n.rest; }, 0); };
    /* 句読点の位置で短く休む */
    notes.forEach(function (n, i) { if (n.phraseEnd && i < notes.length - 1) n.rest += 2; });
    /* 多すぎる：助詞 → 言葉の途中 の順に16分へ詰める */
    var order = notes.map(function (n, i) { return i; }).filter(function (i) { return i < notes.length - 1; });
    order.sort(function (a, b) { return (notes[b].particle - notes[a].particle) || (notes[a].wordEnd - notes[b].wordEnd) || (a - b); });
    for (var k = 0; k < order.length && used() > budget; k++) if (notes[order[k]].dur > 1) notes[order[k]].dur = 1;
    for (k = 0; k < notes.length && used() > budget; k++) if (notes[k].rest > 0) notes[k].rest = 0;
    /* 余る：フレーズ末 → 言葉の終わり の順にのばす */
    var spare = budget - used();
    var last = notes[notes.length - 1];
    var add = Math.min(spare, Math.max(2, Math.round(spare * .45)));
    if (add > 0) { last.dur += add; spare -= add; }
    var ends = notes.map(function (n, i) { return i; }).filter(function (i) { return notes[i].wordEnd && i < notes.length - 1; });
    for (var pass = 0; pass < 3 && spare >= 2 && ends.length; pass++) {
      ends.forEach(function (i) { if (spare >= 2 && R() < .8) { notes[i].dur += 2; spare -= 2; } });
    }
    if (spare > 0) last.dur += spare;
    /* ノリ：言葉の頭を8分の裏から食い気味に（前の音を短くして、その音を前へ） */
    if (sync > 0) {
      for (var j = 1; j < notes.length; j++) {
        var p = notes[j - 1];
        if (p.wordEnd && p.dur >= 4 && R() < sync) { p.dur -= 1; notes[j].dur += 1; }
      }
    }
    return { notes:notes, offset:offset };
  }

  /* ---------- 音高 ---------- */
  var SHAPES = [
    [0, 1, 2, 3, 2, 1, 0], [0, 2, 4, 3, 2, 1, 0], [2, 1, 0, 1, 2, 3, 2], [0, -1, 0, 2, 3, 2, 1],
    [0, 1, 2, 2, 3, 4, 2], [4, 3, 2, 1, 2, 1, 0], [0, 2, 1, 3, 2, 4, 3], [1, 2, 3, 4, 3, 2, 1]
  ];
  function resample(tpl, n) {
    if (n <= 1) return [tpl[0]];
    var out = [];
    for (var i = 0; i < n; i++) { var p = i / (n - 1) * (tpl.length - 1), a = Math.floor(p), b = Math.min(tpl.length - 1, a + 1); out.push(tpl[a] + (tpl[b] - tpl[a]) * (p - a)); }
    return out;
  }
  function nearestChordTone(midi, chord, key, lo, hi) {
    var want = T.chordPitches(chord), best = midi, bd = 99;
    for (var m = midi - 4; m <= midi + 4; m++) {
      if (m < lo || m > hi || want.indexOf(pc(m)) < 0) continue;
      var d = Math.abs(m - midi) + (T.inScale(m, key) ? 0 : 2);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function nearestPc(midi, targetPc, lo, hi) {
    var best = midi, bd = 99;
    for (var m = lo; m <= hi; m++) if (pc(m) === targetPc && Math.abs(m - midi) < bd) { bd = Math.abs(m - midi); best = m; }
    return best;
  }

  /**
   * 1曲（ひとつの案）を作る。
   * input: { lyrics（lyrics.parseの結果）, mood, key:{root,mode}, bpm, seed, profile, range:{lo,hi} }
   */
  function compose(input) {
    var L = input.lyrics, mood = input.mood, prof = input.profile || PROFILES[0], R = rng(input.seed || 1);
    var key = input.key || { root:0, mode:mood.mode }, range = input.range || { lo:57, hi:77 };
    var song = { title:input.title || "", bpm:input.bpm || mood.bpm, key:key, mood:mood.id, groove:input.groove || mood.groove,
      profile:prof.id, sections:[], chords:[], melody:[], lines:[] };

    /* 1. 構成：前奏はサビの進行で4小節（遅い曲は2小節） */
    var introBars = song.bpm < 84 ? 2 : 4, bar = 0;
    song.sections.push({ kind:"intro", start:0, bars:introBars });
    for (var i = 0; i < introBars; i++) song.chords.push(chordOf(key, mood.prog.chorus[i % mood.prog.chorus.length]));
    bar = introBars;

    /* 2・3・4. セクションごとに、行 → フレーズ（2または4小節） */
    var prevNote = null, lastLineIndex = L.lines.length - 1, motifs = {};
    L.sections.forEach(function (sec, si) {
      var prog = mood.prog[sec.kind] || mood.prog.verseA, start = bar, secBar = 0;
      var lift = sec.kind === "chorus" ? (mood.mel.lift + prof.chorusLift) : sec.kind === "verseB" ? 2 : sec.kind === "bridge" ? 1 : 0;
      var centre = Math.round((range.lo + range.hi) / 2) - 3 + lift, ceil = range.hi + (sec.kind === "chorus" ? 1 : 0);
      sec.lines.forEach(function (li, k) {
        var line = L.lines[li], moraCount = line.moras.filter(function (m) { return m.type !== "long" && m.type !== "sokuon"; }).length;
        var bars = moraCount * 2 + 6 > 2 * SPB ? 4 : 2;
        var offset = prof.offset[k % prof.offset.length];
        if (sec.kind === "chorus" && k === 0 && prof.id === "lift") offset = 0;
        var rh = rhythmFor(line, bars, offset, prof.sync, R);
        /* 同じセクションで同じ音数の行は、リズムを揃える（A/A'） */
        var mkey = sec.kind + ":" + rh.notes.length;
        var pair = k % 2 === 1 && motifs[mkey] && motifs[mkey].bars === bars ? motifs[mkey] : null;
        if (pair) { rh.offset = pair.offset; rh.notes.forEach(function (n, j) { n.dur = pair.rhythm[j].dur; n.rest = pair.rhythm[j].rest; }); }
        for (var b = 0; b < bars; b++) song.chords.push(chordOf(key, prog[(secBar + b) % prog.length]));

        /* 音高：形（輪郭）を選び、強拍・長い音を和音の音に寄せる */
        var n = rh.notes.length, shape = pair ? pair.shape : resample(SHAPES[Math.floor(R() * SHAPES.length)], n);
        var spread = sec.kind === "chorus" ? 1.25 : 1, s = (bar * SPB) + rh.offset, cadence = k % 2 === 0 && k < sec.lines.length - 1;
        var finalLine = li === lastLineIndex, notesOut = [];
        rh.notes.forEach(function (nt, j) {
          var deg = T.midiToDegree(centre, key, 4) + Math.round(shape[j] * spread);
          if (j === 0 && sec.kind === "chorus" && k === 0 && R() < prof.leap) deg += 2;
          var m = T.degreeToMidi(deg, key, 4);
          while (m > ceil) m -= 12;
          while (m < range.lo) m += 12;
          var chord = song.chords[Math.floor(s / SPB)] || song.chords[song.chords.length - 1];
          var strong = s % 8 === 0, long = nt.dur >= 4;
          if (strong || long || j === n - 1) m = nearestChordTone(m, chord, key, range.lo - 2, ceil);
          if (prevNote !== null) {
            /* 大きすぎる跳躍は、オクターブを折り返して近づける */
            if (m - prevNote > 9) m -= 12; else if (prevNote - m > 9) m += 12;
            if (m === prevNote && notesOut.length >= 2 && notesOut[notesOut.length - 2].n === m && R() < .7) m = T.snapToScale(m + (R() < .5 ? 2 : -2), key);
          }
          while (m > ceil) m -= 12;
          while (m < range.lo - 2) m += 12;
          if (j === n - 1) {
            /* フレーズの着地：対の1行目は2度か5度（続く感じ）、2行目と最後は主音か3度 */
            var tonic = key.root, third = pc(key.root + (key.mode === "minor" ? 3 : 4)), fifth = pc(key.root + 7), second = pc(key.root + 2);
            var target = finalLine ? tonic : cadence ? (R() < .5 ? second : fifth) : (R() < .65 ? tonic : third);
            m = nearestPc(m, target, range.lo - 2, ceil);
          }
          notesOut.push({ s:s, d:nt.dur, n:m, text:nt.text, line:li });
          prevNote = m;
          s += nt.dur + nt.rest;
        });
        if (!pair) motifs[mkey] = { bars:bars, offset:rh.offset, rhythm:rh.notes.map(function (x) { return { dur:x.dur, rest:x.rest }; }), shape:shape };
        else delete motifs[mkey];
        song.melody = song.melody.concat(notesOut);
        song.lines.push({ index:li, text:line.text, start:bar, bars:bars, section:sec.kind });
        bar += bars; secBar += bars;
      });
      song.sections.push({ kind:sec.kind, start:start, bars:bar - start });
    });

    /* 曲の終わり：最後の小節の和音を主和音に、その前を属和音にして着地させる */
    var tonicChord = { root:key.root, type:key.mode === "minor" ? "min" : "maj" };
    song.chords[bar - 1] = tonicChord;
    /* 主和音に替えた最後の小節で、強拍の音を和音の音へ寄せ直す */
    song.melody.forEach(function (nt) {
      if (Math.floor(nt.s / SPB) === bar - 1 && (nt.s % 8 === 0 || nt.d >= 4)) nt.n = nearestChordTone(nt.n, tonicChord, key, range.lo - 2, range.hi + 6);
    });
    /* 後奏2小節（サビの進行）＋終止1小節 */
    song.sections.push({ kind:"outro", start:bar, bars:2 });
    for (i = 0; i < 2; i++) song.chords.push(chordOf(key, mood.prog.chorus[i % mood.prog.chorus.length]));
    bar += 2;
    song.sections.push({ kind:"ending", start:bar, bars:1 });
    song.chords.push(tonicChord);
    bar += 1;
    song.bars = bar;
    song.totalSteps = bar * SPB;
    return song;
  }

  root.compose = { compose:compose, PROFILES:PROFILES, rhythmFor:rhythmFor, rng:rng };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
