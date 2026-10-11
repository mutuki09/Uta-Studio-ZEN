/* arrange.js — 伴奏の編曲。曲の骨組み（セクション・小節ごとのコード・メロディ）から、
   和音・ベース・ドラム・前奏のフックを1回で組む（何層もの上書きはしない）。
   ・セクションの強弱：Aメロは薄く、Bメロで重ね、サビで全開、後奏から主和音で終止
   ・和音パートの弾き方は楽器表（instruments.js）の comp で決まる
   ・ベースの弾き方はノリと楽器で決まる。次の和音へ向かう経過音つき
   ・ドラムはノリごとにAメロ用とサビ用の型、変わり目と数小節ごとにフィルイン
   楽器・ノリを変えたら、これを呼び直すだけでよい。 */
(function (root) {
  "use strict";
  var T = root.theory, INS = root.instruments, SPB = 16;

  function rng(seed) {
    var s = (Math.imul((seed >>> 0) || 1, 2654435761) ^ 0x5bd1e995) >>> 0 || 1;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function clampV(v) { return Math.max(1, Math.min(127, Math.round(v))); }
  function pc(m) { return ((m % 12) + 12) % 12; }

  var GROOVE_BASS = { ballad:"root", eight:"eighth", rock:"eighth", sixteen:"pump", shuffle:"boogie", bossa:"walk", funk:"funk", march:"march", quiet:"root" };
  function bassStyle(insId, groove) {
    var b = INS.byId(insId).bass || "normal", g = GROOVE_BASS[groove] || "root";
    if (b === "slap" && /^(eight|rock|sixteen|funk|shuffle)$/.test(groove)) return "funk";
    if (b === "upright") return groove === "ballad" || groove === "quiet" ? "two" : /^(bossa|shuffle|eight|march)$/.test(groove) ? "walk" : g;
    if (b === "synth" && /^(eight|rock|sixteen|funk|march)$/.test(groove)) return "synth";
    return g;
  }

  /* ---------- 和音の積み方 ---------- */
  function tones(chord) { return T.chordPitches(chord); }
  function rootNear(chord, around, lo, hi) {
    var target = pc(Number.isFinite(chord.bass) ? chord.bass : chord.root), best = null, dist = 1e9;
    for (var m = lo; m <= hi; m++) if (pc(m) === target && Math.abs(m - around) < dist) { dist = Math.abs(m - around); best = m; }
    return best === null ? lo + target : best;
  }
  /* 前の和音から一番近い転回形（声部がなめらかにつながる） */
  function leadVoicing(chord, prev, lo, hi, count) {
    var p = tones(chord), n = Math.min(count, p.length), best = null, bestCost = 1e9;
    for (var start = 0; start < p.length; start++) {
      for (var oct = Math.floor(lo / 12) - 1; oct <= Math.floor(hi / 12); oct++) {
        var v = [];
        for (var k = 0; k < n; k++) {
          var x = oct * 12 + p[(start + k) % p.length];
          while (v.length && x <= v[v.length - 1]) x += 12;
          v.push(x);
        }
        if (v[0] < lo || v[v.length - 1] > hi) continue;
        var cost = 0;
        if (prev && prev.length) for (k = 0; k < v.length; k++) cost += Math.abs(v[k] - prev[Math.min(k, prev.length - 1)]);
        else cost = Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2);
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
    }
    return best || T.chordVoicing(chord, lo).slice(0, n);
  }
  function guitarVoicing(chord) {
    var r = rootNear(chord, 45, 40, 51);
    return [r].concat(T.chordVoicing(chord, r + 7).slice(0, 4)).filter(function (m) { return m <= 76; });
  }
  function powerChord(chord) { var r = rootNear(chord, 45, 40, 52); return [r, r + 7, r + 12]; }

  function hits(str) { var out = []; for (var i = 0; i < str.length && i < SPB; i++) if (str[i] !== ".") out.push([i, str[i]]); return out; }
  var ACC = { X:1.15, x:1, g:.42 };

  /* ---------- ドラムの型（V＝Aメロ／Bメロ、C＝サビ・前奏・後奏） ---------- */
  var DRUMS = {
    ballad: { V:{ kick:"x.........x.....", side:"........x.......", hat:"x...x...x...x..." },
              C:{ kick:"x.....x...x.....", snare:"....x.......x...", hat:"x.x.x.x.x.x.x.x." } },
    eight:  { V:{ kick:"x.....x.x.......", snare:"....x.......x...", hat:"x.x.x.x.x.x.x.x." },
              C:{ kick:"x.....x.x.x.....", snare:"....X.......X...", hat:"x.x.x.x.x.x.x...", open:"..............x." } },
    rock:   { V:{ kick:"x.....x.x.....x.", snare:"....X.......X...", hat:"x.x.x.x.x.x.x.x." },
              C:{ kick:"x.x...x.x.x...x.", snare:"....X.......X...", ride:"x.x.x.x.x.x.x.x." } },
    sixteen:{ V:{ kick:"x.....x.x.......", snare:"....x.......x...", hat:"xgxgxgxgxgxgxgxg" },
              C:{ kick:"x..x..x.x.x.....", snare:"....X..g....X...", hat:"xgxgxgxgxgxgxg..", open:"..............x." } },
    shuffle:{ V:{ kick:"x.......x.......", snare:"....x.......x...", hat:"x..xx..xx..xx..x" },
              C:{ kick:"x.....x.x.......", snare:"....X.......X...", ride:"x..xx..xx..xx..x" } },
    bossa:  { V:{ kick:"x..x....x..x....", side:"x..x..x...x..x..", hat:"x.x.x.x.x.x.x.x." },
              C:{ kick:"x..x....x..x....", side:"x..x..x...x..x..", ride:"x.x.x.x.x.x.x.x." } },
    funk:   { V:{ kick:"x..x......x..x..", snare:"....x..g.g..x...", hat:"xgxgxgxgxgxgxgxg" },
              C:{ kick:"x..x..x...x..x..", snare:"....X..g.g..X..g", hat:"xgxgxgxgxgxgxg..", open:"..............x." } },
    march:  { V:{ kick:"x.......x.......", snare:"....x.x.....x.x.", hat:"x...x...x...x..." },
              C:{ kick:"x...x...x...x...", snare:"....X.x.....X.xx", hat:"x.x.x.x.x.x.x.x." } },
    quiet:  { V:{}, C:{ kick:"x.......x.......", ride:"x...x...x...x..." } }
  };
  var DRUM_VEL = { kick:104, snare:100, side:84, hat:72, open:84, ride:76, crash:112, tomH:96, tomM:98, tomL:100 };
  var ENERGY = { intro:.7, verseA:.5, verseB:.72, chorus:1, bridge:.62, outro:.85, ending:1 };

  function drumBar(out, at, groove, kind, e, R, crash) {
    var set = DRUMS[groove] || DRUMS.eight, big = kind === "chorus" || kind === "outro" || kind === "intro";
    var pat = big ? set.C : set.V;
    if (kind === "verseB" && set.C.open) { pat = {}; Object.keys(set.V).forEach(function (k) { pat[k] = set.V[k]; }); pat.open = "..............x."; }
    Object.keys(pat).forEach(function (k) {
      hits(pat[k]).forEach(function (h) {
        out.push({ s:at + h[0], kind:k, v:clampV(DRUM_VEL[k] * ACC[h[1]] * (.72 + .28 * e) * (.94 + R() * .12)) });
      });
    });
    if (crash && groove !== "quiet") {
      out.push({ s:at, kind:"crash", v:clampV(DRUM_VEL.crash * (.8 + .2 * e)) });
      if (!out.some(function (d) { return d.s === at && d.kind === "kick"; })) out.push({ s:at, kind:"kick", v:104 });
    }
  }
  function fill(out, at, big, groove) {
    if (groove === "quiet") return;
    var from = big ? 8 : 12;
    for (var i = out.length - 1; i >= 0; i--) if (out[i].s >= at + from && out[i].s < at + SPB && out[i].kind !== "kick") out.splice(i, 1);
    var seq = big
      ? [[8,"snare",.7],[9,"snare",.4],[10,"tomH",.85],[11,"tomH",.7],[12,"tomM",.9],[13,"tomM",.75],[14,"tomL",1],[15,"tomL",.9]]
      : groove === "ballad" ? [[12,"tomH",.6],[14,"tomM",.7],[15,"tomL",.75]]
      : [[12,"snare",.6],[13,"snare",.45],[14,"snare",.8],[15,"snare",.95]];
    seq.forEach(function (x) { out.push({ s:at + x[0], kind:x[1], v:clampV(DRUM_VEL[x[1]] * x[2] * 1.05), fill:true }); });
  }

  /* ---------- ベース ---------- */
  function bassBar(out, at, chord, next, style, kind, e, R) {
    var r = rootNear(chord, 40, 33, 47), t = tones(chord), fifth = r + 7, oct = r + 12;
    var third = r + (t.indexOf(pc(chord.root + 3)) >= 0 ? 3 : 4);
    var sev = t.indexOf(pc(chord.root + 10)) >= 0 ? r + 10 : t.indexOf(pc(chord.root + 11)) >= 0 ? r + 11 : oct;
    var base = 92 * (.75 + .25 * e), add = function (s, d, n, m) { out.push({ s:at + s, d:d, n:n, v:clampV(base * (m || 1) * (.95 + R() * .1)) }); };
    var thin = kind === "verseA" && e < .6;
    switch (style) {
      case "root":
        if (thin || kind === "intro") add(0, 15, r); else { add(0, 7, r, 1.05); add(8, 6, kind === "chorus" ? fifth : r, .9); }
        return;
      case "two": add(0, 7, r, 1.05); add(8, 6, fifth, .9); return;
      case "march": add(0, 6, r, 1.05); add(8, 6, fifth, .95); return;
      case "eighth":
        for (var i = 0; i < 8; i++) { if (thin && i % 2) continue; add(i * 2, thin ? 3.5 : 1.7, kind === "chorus" && (i === 3 || i === 7) ? oct : r, i % 2 ? .82 : 1.02); }
        return;
      case "pump":
        [[0,r,2,1.05],[3,r,1,.8],[6,oct,1,.85],[8,r,2,1],[11,fifth,1,.8],[12,r,2,.95],[14,oct,1,.85]].forEach(function (x, k) { if (!(thin && k % 2)) add(x[0], x[2], x[1], x[3]); });
        return;
      case "funk":
        [[0,r,1.5,1.1],[3,oct,.8,.9],[6,r,1,.95],[7,sev,.8,.75],[10,r,1.5,1],[12,oct,.8,.9],[14,fifth,.8,.8],[15,oct,.5,.6]].forEach(function (x, k) { if (!(thin && k > 4)) add(x[0], x[2], x[1], x[3]); });
        return;
      case "synth": for (var j = 0; j < 8; j++) add(j * 2, 1.4, j % 2 ? oct : r, j % 2 ? .85 : 1); return;
      case "boogie": [r, third, fifth, r + 9].forEach(function (n, k) { add(k * 4, 3, n, k ? .88 : 1.04); }); return;
      case "walk":
        var nr = next ? rootNear(next, r, r - 7, r + 7) : r, approach = nr + (nr > r ? -1 : 1);
        var line = [r, R() < .5 ? third : fifth, R() < .5 ? fifth : r + 9, approach];
        if (line[2] === approach) line[2] = fifth;
        line.forEach(function (n, k) { add(k * 4, 3.4, n, k ? .9 : 1.05); });
        return;
    }
  }
  function bassApproach(out, at, chord, next, key) {
    if (!next || pc(next.root) === pc(chord.root)) return;
    var keep = out.filter(function (n) { return n.s >= at && n.s < at + 14; });
    var prev = keep.length ? keep[keep.length - 1].n : rootNear(chord, 40, 33, 47);
    var target = rootNear(next, prev, 31, 50), c = [target - 1, target + 1, target - 2, target + 2];
    c.sort(function (a, b) { return ((T.inScale(a, key) ? 0 : 3) + Math.abs(a - prev)) - ((T.inScale(b, key) ? 0 : 3) + Math.abs(b - prev)); });
    for (var i = out.length - 1; i >= 0; i--) {
      var n = out[i];
      if (n.s >= at + 14 && n.s < at + SPB) out.splice(i, 1);
      else if (n.s >= at && n.s < at + 14 && n.s + n.d > at + 14) n.d = at + 14 - n.s;
    }
    out.push({ s:at + 14, d:1.8, n:c[0], v:84 });
  }

  /* ---------- 和音パート ---------- */
  function compBar(out, at, chord, style, groove, kind, e, R, st) {
    var base = 80 * (.62 + .38 * e), push = function (s, d, notes, m, dir) {
      if (notes && notes.length) out.push({ s:at + s, d:d, chord:notes.slice(), v:clampV(base * (m || 1) * (.94 + R() * .12)), dir:dir || 1 });
    };
    var slow = groove === "ballad" || groove === "quiet", busy = groove === "sixteen" || groove === "funk", latin = groove === "bossa";
    var thin = kind === "verseA", big = kind === "chorus" || kind === "outro";
    switch (style) {
      case "piano": {
        var v = st.pv = leadVoicing(chord, st.pv, 55, 76, 4);
        if (slow) {
          if (big) { push(0, 7.5, v, 1.05); push(8, 7, v, .9); push(0, 15, [v[v.length - 1] + 12], .7); }
          else [0,1,2,3,2,1,2,3].forEach(function (k, i) { push(i * 2, 2.6, [v[Math.min(k, v.length - 1)] - 12], i ? .7 : .85); });
        } else if (latin) hits("x..x..x...x..x..").forEach(function (h) { push(h[0], 2, v, h[0] ? .85 : 1); });
        else if (busy) hits(big ? "x..x..x...x.x..." : "x.....x...x.....").forEach(function (h) { push(h[0], 1.6, v, h[0] % 4 ? .85 : 1); });
        else if (thin) [0, 4, 8, 12].forEach(function (s, i) { push(s, 3, v, i ? .78 : .95); });
        else [0,2,4,6,8,10,12,14].forEach(function (s) { push(s, 1.6, v, s === 0 || s === 6 ? 1.05 : .78); });
        return;
      }
      case "ep": {
        var ev = st.ev = leadVoicing(chord, st.ev, 53, 74, 4);
        if (slow) { push(0, 7.5, ev, 1); if (!thin) push(8, 7, ev, .85); }
        else if (busy) hits("x..x..x...x.x...").forEach(function (h) { push(h[0], 1.5, ev, h[0] ? .85 : 1); });
        else if (latin) hits("x..x..x...x..x..").forEach(function (h) { push(h[0], 2, ev, .9); });
        else { push(0, 5.5, ev, 1); push(6, 3.5, ev, .82); if (!thin) push(10, 5.5, ev, .9); }
        return;
      }
      case "acoustic": {
        var gv = guitarVoicing(chord);
        if (slow || latin && thin) {
          [0, 2, 3, 4, 3, 2, 3, 4].forEach(function (k, i) { push(i * 2, slow ? 6 : 3, [gv[Math.min(k, gv.length - 1)]], i ? .72 : .9); });
          if (big && slow) push(0, 14, gv, .75);
        } else if (latin) hits("x..x..x...x..x..").forEach(function (h) { push(h[0], 1.8, gv.slice(1), h[0] ? .8 : .95, 1); });
        else if (thin) [[0,1,1],[8,1,.9],[12,-1,.7]].forEach(function (x, i, a) { push(x[0], (a[i + 1] ? a[i + 1][0] : SPB) - x[0] - .2, gv, x[2], x[1]); });
        else [[0,1,1.05],[4,1,.85],[6,-1,.7],[10,-1,.72],[12,1,.85],[14,-1,.7]].forEach(function (x, i, a) {
          push(x[0], (a[i + 1] ? a[i + 1][0] : SPB) - x[0] - .2, x[1] > 0 ? gv : gv.slice(-4), x[2], x[1]);
        });
        return;
      }
      case "clean": {
        var cv = guitarVoicing(chord), top = cv.slice(-3);
        if (slow) [0, 4, 8, 12].forEach(function (s, i) { push(s, 3.6, [cv[Math.min(1 + i, cv.length - 1)]], i ? .7 : .85); });
        else if (busy) {
          for (var c = 0; c < SPB; c++) {
            var acc = [0, 3, 6, 10, 12, 14].indexOf(c) >= 0;
            if (thin && !acc && c % 2) continue;
            push(c, acc ? .7 : .3, top, acc ? 1 : .3, c % 2 ? -1 : 1);
          }
        } else if (big) [0,2,4,6,8,10,12,14].forEach(function (s, i) { push(s, 1.6, i % 2 ? top : cv, i % 2 ? .72 : .95, i % 2 ? -1 : 1); });
        else hits("..x...x...x...x.").forEach(function (h) { push(h[0], .9, top, .85, -1); });
        return;
      }
      case "crunch": {
        var pw = powerChord(chord);
        if (slow) { push(0, 15, pw, .9); return; }
        if (big || kind === "intro") { push(0, 5.5, pw, 1.08); push(6, 1.8, pw, .9); push(8, 5.5, pw, 1); push(14, 1.8, pw, .9); }
        else [0,2,4,6,8,10,12,14].forEach(function (s) { push(s, .8, pw, s % 8 ? .62 : .78); });
        return;
      }
      case "brass": {
        var bv = st.bv = leadVoicing(chord, st.bv, 60, 79, 3);
        if (kind === "verseA") return;
        if (slow || kind === "verseB" || kind === "bridge") { push(0, 14, bv, kind === "verseB" ? .7 : .8); return; }
        hits(kind === "intro" ? "X..X..X........." : "x.....x...x.x...").forEach(function (h, i) {
          push(h[0], h[0] === 12 || (kind === "intro" && h[0] === 6) ? 3.5 : 1.2, bv, h[1] === "X" ? 1.1 : (i ? .9 : 1));
        });
        return;
      }
      case "arp": {
        var av = leadVoicing(chord, null, 57, 72, 3), seq = av.concat(av.map(function (m) { return m + 12; }));
        var step = big && !slow ? 1 : 2, nn = SPB / step;
        for (var a = 0; a < nn; a++) {
          var idx = a % (seq.length * 2 - 2), k = idx < seq.length ? idx : seq.length * 2 - 2 - idx;
          if (thin && a % 2) continue;
          push(a * step, step * 1.6, [seq[k]], a % 4 ? .75 : .95);
        }
        return;
      }
      case "saw": {
        var sv = st.sv = leadVoicing(chord, st.sv, 55, 76, 4);
        if (big) push(0, 15.5, sv.concat([sv[0] + 12]), 1);
        else if (slow) push(0, 15.5, sv, .8);
        else [2, 6, 10, 14].forEach(function (s) { push(s, 1.2, sv, .85); });
        return;
      }
      default: {
        var pv = st.padv = leadVoicing(chord, st.padv, 52, 72, 4);
        if (big) pv = pv.concat([pv[0] + 12]);
        push(0, 15.6, pv, thin ? .72 : 1);
      }
    }
  }

  /* メロディの強弱：フレーズの山なり＋拍の強弱＋サビで強く */
  function melodyVelocity(song, kinds) {
    var byLine = {};
    song.melody.forEach(function (n) { (byLine[n.line] = byLine[n.line] || []).push(n); });
    Object.keys(byLine).forEach(function (l) {
      var ns = byLine[l];
      ns.forEach(function (n, i) {
        var pos = ns.length <= 1 ? 0 : i / (ns.length - 1), loc = ((Math.round(n.s) % SPB) + SPB) % SPB;
        var acc = loc === 0 ? 9 : loc === 8 ? 6 : loc % 4 === 0 ? 3 : loc % 2 ? -3 : 0, k = kinds[Math.floor(n.s / SPB)];
        n.v = Math.max(64, Math.min(122, Math.round(90 + Math.sin(Math.PI * pos) * 9 + acc + (k === "chorus" ? 9 : k === "verseB" ? 4 : 0))));
      });
    });
  }

  /* ---------- 見せ場 ---------- */
  /* その小節の［from, at+16）にかかる音を消す（前から伸びてくる音は手前で切る） */
  function clearRegion(list, from, to) {
    for (var i = list.length - 1; i >= 0; i--) {
      var n = list[i];
      if (n.s >= from && n.s < to) list.splice(i, 1);
      else if (n.d !== undefined && n.s < from && n.s + n.d > from) n.d = Math.max(.5, from - n.s);
    }
  }
  var KIME = ["x.....x.....x...", "x..x..x.....x...", "x.....x...x.....", "x.x...x.....x..."];
  /* キメ：全員が同じ位置で短く鳴らす。最後の一打は少しのばし、ドラムは16分で次へつなぐ */
  function kimeBar(at, chord, layers, bass, drums, groove, R) {
    var pat = hits(KIME[Math.floor(R() * KIME.length)]), last = pat[pat.length - 1][0];
    layers.forEach(function (l) {
      clearRegion(l.out, at, at + SPB);
      var v = l.style === "crunch" ? powerChord(chord) : l.style === "acoustic" || l.style === "clean" ? guitarVoicing(chord) : leadVoicing(chord, l.st.pv || l.st.ev || l.st.padv || l.st.bv || l.st.sv, 55, 77, 4);
      pat.forEach(function (h, i) { l.out.push({ s:at + h[0], d:h[0] === last ? 2.5 : 1.1, chord:v, v:i ? 104 : 112, dir:1, kime:true }); });
    });
    clearRegion(bass, at, at + SPB);
    var r = rootNear(chord, 40, 33, 47);
    pat.forEach(function (h) { bass.push({ s:at + h[0], d:h[0] === last ? 2.5 : 1.1, n:r, v:108 }); });
    clearRegion(drums, at, at + SPB);
    pat.forEach(function (h, i) {
      drums.push({ s:at + h[0], kind:"kick", v:110 }, { s:at + h[0], kind:i === 0 || h[0] === last ? "crash" : "snare", v:i === 0 ? 116 : 104 });
    });
    for (var s = last + 1; s < SPB; s++) drums.push({ s:at + s, kind:"snare", v:clampV(70 + (s - last) * 9), fill:true });
  }
  /* ブレイク：小節の後半で全員が止まり、スネアだけが詰めていってサビへ */
  function breakBar(at, chord, layers, bass, drums, groove, R) {
    var from = at + 8;
    layers.forEach(function (l) {
      clearRegion(l.out, from, at + SPB);
      l.out.push({ s:from, d:.8, chord:leadVoicing(chord, null, 55, 74, 3), v:100, dir:1 });
    });
    clearRegion(bass, from, at + SPB);
    bass.push({ s:from, d:.8, n:rootNear(chord, 40, 33, 47), v:104 });
    clearRegion(drums, from, at + SPB);
    drums.push({ s:from, kind:"kick", v:108 }, { s:from, kind:"crash", v:100 });
    var roll = groove === "ballad" ? [12, 14] : [12, 13, 14, 15];
    if (groove !== "ballad") drums.push({ s:at + 10, kind:"snare", v:80 });
    roll.forEach(function (s, i) { drums.push({ s:at + s, kind:groove === "ballad" ? "tomM" : "snare", v:clampV(84 + i * 10), fill:true }); });
  }
  /* 掛け合い：歌メロが2拍以上のばす音の後ろで、別の楽器が3〜4音の短いフレーズで答える。
     答える楽器は、ブラスの層があればブラス、なければ歌メロと違う楽器の層。Aメロでは控えめ。 */
  function callAndResponse(song, kinds, layers, ins, R) {
    var cand = layers.filter(function (l) { return l.style === "brass"; })[0] ||
      layers.filter(function (l) { return l.ins !== ins.melody && l.style !== "pad" && l.style !== "crunch"; })[0];
    if (!cand) return null;
    var key = song.key, notes = [], mel = song.melody.slice().sort(function (a, b) { return a.s - b.s; });
    mel.forEach(function (n, i) {
      var nx = mel[i + 1], k = kinds[Math.floor(n.s / SPB)];
      if (!nx || n.d < 8 || (k !== "chorus" && k !== "verseB" && !(k === "verseA" && R() < .35))) return;
      var from = n.s + 4, to = Math.min(nx.s - 1, n.s + n.d + 2);
      if (to - from < 5 || R() < .25) return;
      var chord = song.chords[Math.floor(from / SPB)], t = T.chordPitches(chord), pool = [];
      for (var m = 62; m <= 81; m++) if (t.indexOf(pc(m)) >= 0 || (R() < .3 && T.inScale(m, key))) pool.push(m);
      pool = pool.filter(function (m) { return Math.abs(m - n.n) >= 2; });
      if (!pool.length) return;
      /* 歌の音から少し離れた高さで、上がるか下がる3〜4音 */
      var up = R() < .55, start = pool[Math.floor(R() * pool.length)], seq = [start], cnt = to - from >= 8 ? 4 : 3;
      for (var j = 1; j < cnt; j++) {
        var cands = pool.filter(function (m) { return up ? m > seq[j - 1] && m - seq[j - 1] <= 5 : m < seq[j - 1] && seq[j - 1] - m <= 5; });
        seq.push(cands.length ? cands[0 + (up ? 0 : cands.length - 1)] : seq[j - 1]);
      }
      var stepLen = cnt === 4 ? 2 : 2, s0 = from;
      seq.forEach(function (m, j) { notes.push({ s:s0 + j * stepLen, d:j === seq.length - 1 ? Math.max(1.5, to - (s0 + j * stepLen)) : 1.6, n:m, v:j === seq.length - 1 ? 96 : 88 }); });
    });
    return notes.length ? { ins:cand.ins, notes:notes } : null;
  }

  /** song（compose.compose の結果）に parts を作って入れる。opts: { seed } */
  function arrange(song, opts) {
    var o = opts || {}, R = rng((o.seed || 7) + 17), ins = song.instruments, groove = song.groove, key = song.key;
    var kinds = [];
    song.sections.forEach(function (s) { for (var b = 0; b < s.bars; b++) kinds[s.start + b] = s.kind; });
    var total = song.bars, bStyle = bassStyle(ins.bass, groove);
    var bass = [], drums = [], fillEvery = groove === "ballad" || groove === "quiet" ? 8 : 4;
    /* 和音は何層でも重ねられる。各層：楽器・弾き方（auto＝楽器の得意な弾き方）・出番・音量 */
    var layers = (ins.layers && ins.layers.length ? ins.layers : [{ ins:ins.comp, style:"auto", when:"all", vol:1 }]).map(function (l) {
      return { ins:l.ins, style:l.style && l.style !== "auto" ? l.style : (INS.byId(l.ins).comp || "pad"), when:l.when || "all", vol:l.vol === undefined ? 1 : l.vol, out:[], st:{} };
    });
    var ON = { all:null, build:{ verseB:1, chorus:1, bridge:1, outro:1, ending:1, intro:1 }, chorus:{ chorus:1, outro:1, ending:1, intro:1 }, verse:{ verseA:1, verseB:1, bridge:1 } };
    var active = function (l, k) { return !ON[l.when] || !!ON[l.when][k]; };
    var introBars = song.sections[0] && song.sections[0].kind === "intro" ? song.sections[0].bars : 0;
    for (var b = 0; b < total; b++) {
      var at = b * SPB, k = kinds[b] || "verseA", e = ENERGY[k] || .6, ch = song.chords[b], nx = b + 1 < total ? song.chords[b + 1] : null;
      if (k === "ending") {
        layers.forEach(function (l) {
          if (!active(l, "ending")) return;
          var s = l.st, fv = l.style === "crunch" ? powerChord(ch) : l.style === "acoustic" || l.style === "clean" ? guitarVoicing(ch) : leadVoicing(ch, s.pv || s.ev || s.padv || s.bv || s.sv, 52, 76, 4);
          l.out.push({ s:at, d:SPB, chord:fv, v:96, dir:1 });
        });
        bass.push({ s:at, d:SPB, n:rootNear(ch, 40, 33, 47), v:100 });
        drums.push({ s:at, kind:"crash", v:118 }, { s:at, kind:"kick", v:112 });
        continue;
      }
      layers.forEach(function (l) { if (active(l, k)) compBar(l.out, at, ch, l.style, groove, k, e, R, l.st); });
      bassBar(bass, at, ch, nx, bStyle, k, e, R);
      var change = b + 1 < total && kinds[b + 1] !== k;
      if (bStyle !== "walk" && bStyle !== "synth" && (change || (b - introBars) % 2 === 1) && kinds[b + 1] !== "ending") bassApproach(bass, at, ch, nx, key);
      var entering = b === 0 || kinds[b - 1] !== k;
      drumBar(drums, at, groove, k, e, R, entering && (b === 0 || k !== "verseA" || b === introBars));
      if (change && kinds[b + 1] !== "ending") fill(drums, at, kinds[b + 1] === "chorus" || kinds[b + 1] === "outro", groove);
      else if (kinds[b + 1] === "ending") fill(drums, at, true, groove);
      else if (!change && b >= introBars && (b - introBars) % fillEvery === fillEvery - 1) fill(drums, at, false, groove);
    }
    /* ---- 曲の見せ場：サビ前のキメ／ブレイク、前奏の締めのキメ ---- */
    /* AI設計図でキメ・ブレイクの位置が指定されていれば、それに従う */
    var events = song.forcedEvents ? song.forcedEvents.slice() : [];
    if (!song.forcedEvents && groove !== "quiet") for (b = 0; b < total - 1; b++) {
      var here = kinds[b], next = kinds[b + 1];
      if (here === "intro" && next !== "intro") { if (groove !== "ballad") events.push({ bar:b, type:"kime" }); }
      else if (next === "chorus" && here !== "chorus") events.push({ bar:b, type:groove === "ballad" ? "break" : (R() < (song.profile === "lift" ? .75 : .55) ? "kime" : "break") });
      else if (here === "chorus" && next === "outro" && groove !== "ballad") events.push({ bar:b, type:"kime" });
    }
    events.forEach(function (ev) { (ev.type === "kime" ? kimeBar : breakBar)(ev.bar * SPB, song.chords[ev.bar], layers, bass, drums, groove, R); });
    /* ---- 掛け合い：歌メロが長くのばしている間に、別の楽器が短く答える ---- */
    var answer = callAndResponse(song, kinds, layers, ins, R);
    melodyVelocity(song, kinds);
    /* 前奏のフック：サビの頭のメロディを、メロディ楽器で（前奏はサビと同じ進行なので和音も合う） */
    var lead = [], chorus = song.sections.filter(function (s) { return s.kind === "chorus"; })[0];
    if (introBars && chorus) {
      var from = chorus.start * SPB, to = (chorus.start + introBars) * SPB;
      song.melody.forEach(function (n) {
        if (n.s >= from && n.s < to) lead.push({ s:n.s - from, d:Math.max(.5, Math.min(n.d, to - n.s) * .95), n:n.n, v:clampV((n.v || 96) * .95) });
      });
    }
    /* パート間の音量合わせ：弾き方によって音の詰まり方が違うので、全雰囲気を書き出して実測した値で補正する */
    var slow = groove === "ballad" || groove === "quiet", latin = groove === "bossa";
    var COMP = { piano:slow ? 1.5 : 1, ep:1.4, acoustic:slow ? 1.2 : latin ? .8 : .5, clean:1, crunch:.73, brass:2, saw:1.6, arp:.6, pad:1 };
    /* 重ねるほど、1層あたりは少し控えめに（全体の厚みが増えるぶん） */
    var stack = 1 / Math.sqrt(Math.max(1, layers.length * .75));
    song.parts = {
      layers:layers.map(function (l) {
        return { ins:l.ins, style:l.style, when:l.when, gain:(COMP[l.style] || 1) * l.vol * stack, notes:l.out.sort(function (x, y) { return x.s - y.s; }) };
      }),
      bass:bass.sort(function (x, y) { return x.s - y.s; }),
      drums:drums.sort(function (x, y) { return x.s - y.s; }),
      lead:lead,
      answer:answer
    };
    song.arrangement = { comp:layers[0].style, layers:layers.map(function (l) { return l.style; }), bass:bStyle, groove:groove,
      events:events.map(function (e) { return e.type + "@" + e.bar; }), answers:answer ? answer.notes.length : 0 };
    song.mix = { melody:1.2, comp:1, bass:bStyle === "synth" ? 1 : slow ? .7 : .63, drums:slow ? .7 : .53 };
    return song;
  }

  var STYLES = [["auto","おまかせ"],["pad","のばす"],["piano","8分で刻む"],["ep","シンコペーションで刻む"],["acoustic","ストローク／アルペジオ"],["clean","カッティング"],["crunch","パワーコード"],["arp","アルペジオ（分散）"],["brass","キメ（ブラス風）"],["saw","裏打ち→サビで伸ばす"]];
  var WHEN = [["all","曲全体"],["build","Bメロから"],["chorus","サビだけ"],["verse","Aメロ・Bメロだけ"]];
  root.arrange = { arrange:arrange, bassStyle:bassStyle, STYLES:STYLES, WHEN:WHEN };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
