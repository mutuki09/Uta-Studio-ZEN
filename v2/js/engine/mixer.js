/* engine/mixer.js — Web Audio を使わずに書き出す（ターミナル用。ブラウザでも動く）。
   player.js の組み立て（ボディ・アンプ・キャビネット・響板・コーラス・パン・コンプ・リミッター・残響）を
   素の JavaScript で同じ順に行う。畳み込みは FFT の重畳加算、コンプは Web Audio の仕様に近い形。 */
(function (root) {
  "use strict";
  var C = root.core, INS = root.instruments;

  /* ---------- FFT（基数2・その場計算） ---------- */
  function fft(re, im, inv) {
    var n = re.length, i, j, k, len;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < len / 2; k++) {
          var a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
    if (inv) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
  /* 畳み込み（重畳加算）。x と ir は Float32Array、長さ x.length の結果を返す */
  function convolve(x, ir) {
    var B = 1; while (B < ir.length) B <<= 1;
    var N = B * 2, hr = new Float64Array(N), hi = new Float64Array(N), out = new Float32Array(x.length);
    hr.set(ir); fft(hr, hi, false);
    var xr = new Float64Array(N), xi = new Float64Array(N);
    for (var start = 0; start < x.length; start += B) {
      xr.fill(0); xi.fill(0);
      var end = Math.min(x.length, start + B), any = false;
      for (var i = start; i < end; i++) { xr[i - start] = x[i]; if (x[i]) any = true; }
      if (!any) continue;
      fft(xr, xi, false);
      for (i = 0; i < N; i++) { var r = xr[i] * hr[i] - xi[i] * hi[i]; xi[i] = xr[i] * hi[i] + xi[i] * hr[i]; xr[i] = r; }
      fft(xr, xi, true);
      for (i = 0; i < N && start + i < x.length; i++) out[start + i] += xr[i];
    }
    return out;
  }

  /* ---------- コンプレッサー（Web Audio の DynamicsCompressor に近い：ニー・比率・自動メイクアップ） ---------- */
  function compressor(L, R, sr, o) {
    var th = o.threshold, knee = o.knee || 0, ratio = o.ratio;
    function curve(db) {
      if (db < th - knee / 2) return db;
      if (knee > 0 && db < th + knee / 2) { var x = db - th + knee / 2; return db + (1 / ratio - 1) * x * x / (2 * knee); }
      return th + (db - th) / ratio;
    }
    var full = Math.pow(10, (curve(0) - 0) / 20), makeup = Math.pow(1 / full, .6);
    var aC = Math.exp(-1 / (Math.max(.001, o.attack) * sr)), rC = Math.exp(-1 / (Math.max(.001, o.release) * sr)), red = 0;
    /* ブラウザのコンプと同じく、約6ms先を見て早めに効かせる（先読み） */
    var la = Math.round(.006 * sr), n = L.length;
    /* 先読み区間の最大値（単調キューで求める）。リミッター（o.peak）は、その区間の山に間に合うよう即座に下げる */
    var q = [], qh = 0, amp = function (k) { return Math.max(Math.abs(L[k]), Math.abs(R[k])); };
    for (var k0 = 0; k0 < Math.min(n, la); k0++) { while (q.length > qh && amp(q[q.length - 1]) <= amp(k0)) q.pop(); q.push(k0); }
    for (var i = 0; i < n; i++) {
      var j = i + la;
      if (j < n) { while (q.length > qh && amp(q[q.length - 1]) <= amp(j)) q.pop(); q.push(j); }
      while (q[qh] < i) qh++;
      var lv = o.peak ? amp(q[qh]) : amp(Math.min(n - 1, j)), db = lv > 1e-6 ? 20 * Math.log10(lv) : -120;
      var want = db - curve(db);
      if (o.peak) red = want > red ? want : rC * red + (1 - rC) * want;
      else red = want > red ? aC * red + (1 - aC) * want : rC * red + (1 - rC) * want;
      var g = Math.pow(10, -red / 20) * makeup;
      L[i] *= g; R[i] *= g;
    }
  }
  function shaper(x, curve) {
    var n = curve.length - 1;
    for (var i = 0; i < x.length; i++) {
      var p = (Math.max(-1, Math.min(1, x[i])) + 1) / 2 * n, a = Math.floor(p), f = p - a;
      x[i] = a >= n ? curve[n] : curve[a] * (1 - f) + curve[a + 1] * f;
    }
  }
  function chorus(L, R, sr, amount) {
    var outL = new Float32Array(L.length), outR = new Float32Array(R.length), dry = 1 - amount * .3, wet = amount * .7;
    var tap = function (buf, i, delay) { var p = i - delay * sr, a = Math.floor(p), f = p - a; return a < 0 ? 0 : buf[a] * (1 - f) + (a + 1 < buf.length ? buf[a + 1] : 0) * f; };
    for (var i = 0; i < L.length; i++) {
      var lfo = Math.sin(2 * Math.PI * .6 * i / sr) * .0025;
      outL[i] = L[i] * dry + wet * (tap(L, i, .012 + lfo) + tap(L, i, .017 - lfo));
      outR[i] = R[i] * dry + wet * (tap(R, i, .012 + lfo) + tap(R, i, .017 - lfo));
    }
    return [outL, outR];
  }
  function pan(L, R, p) {
    var x = p <= 0 ? p + 1 : p, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
    for (var i = 0; i < L.length; i++) {
      if (p <= 0) { L[i] = L[i] + R[i] * gl; R[i] = R[i] * gr; }
      else { var l = L[i]; L[i] = l * gl; R[i] = R[i] + l * gr; }
    }
  }

  /* エンジン1台を最後まで計算する */
  function renderEngine(snd, events, sr, n) {
    var eng = C.engineOf(snd), Cls = root.physDsp[eng.engine](), d = new Cls(sr);
    eng.init.forEach(function (m) { d.handle(JSON.parse(JSON.stringify(m))); });
    d.handle({ type:"ev", list:events.map(function (e) { var c = {}, k; for (k in e) c[k] = e[k]; return c; }) });
    var L = new Float32Array(n), R = new Float32Array(n);
    for (var i = 0; i < n; i += 128) { var m = Math.min(128, n - i); d.render(L.subarray(i, i + m), R.subarray(i, i + m), m, i); }
    return [L, R];
  }
  function mixInto(dst, src, g) { for (var i = 0; i < dst.length; i++) dst[i] += src[i] * g; }

  /** parts（score.parts / player.buildParts の結果）→ { L, R, sampleRate }。onProgress(0〜1) */
  function render(parts, opts) {
    var o = opts || {}, sr = o.sampleRate || 44100, n = Math.ceil((o.seconds || 10) * sr), irs = C.irs(sr), master = o.master || { volume:.75, reverb:.16 };
    var busL = new Float32Array(n), busR = new Float32Array(n);
    parts.forEach(function (p, idx) {
      var snd = p.snd, sig = renderEngine(snd, p.events, sr, n), L = sig[0], R = sig[1], sp = (snd.kind === "gtr" || snd.kind === "bass" ? C.strProfile(snd) : {}), outL, outR;
      if (snd.kind === "gtr" && sp.mode === "acoustic") {
        var bd = .12 + .5 * (1 - sp.body), bw = sp.body, cl = convolve(L, irs.body[0]), cr = convolve(R, irs.body[1]);
        outL = new Float32Array(n); outR = new Float32Array(n); mixInto(outL, L, bd); mixInto(outR, R, bd); mixInto(outL, cl, bw); mixInto(outR, cr, bw);
      } else if (snd.kind === "gtr" || snd.kind === "bass") {
        var bass = snd.kind === "bass", dr = bass ? 0 : sp.drive || 0;
        if (dr > .01) {
          var cv = C.driveCurve(dr), pre = 1 + dr * 5, post = 1 / (1 + dr * 2.2);
          for (var i = 0; i < n; i++) { L[i] *= pre; R[i] *= pre; }
          shaper(L, cv); shaper(R, cv);
          for (i = 0; i < n; i++) { L[i] *= post; R[i] *= post; }
        }
        var ir = bass ? irs.bcab : irs.gcab, cd = bass ? .15 : .12;
        outL = convolve(L, ir[0]); outR = convolve(R, ir[1]); mixInto(outL, L, cd); mixInto(outR, R, cd);
        if (bass) compressor(outL, outR, sr, { threshold:-24, ratio:4, knee:30, attack:.01, release:.2 });
      } else if (snd.board) {
        var b1 = .35 + .4 * (1 - snd.board), b2 = snd.board * .9;
        outL = new Float32Array(n); outR = new Float32Array(n); mixInto(outL, L, b1); mixInto(outR, R, b1);
        mixInto(outL, convolve(L, irs.board[0]), b2); mixInto(outR, convolve(R, irs.board[1]), b2);
      } else { outL = L; outR = R; }
      var gain = (snd.trim || 1) * (p.gain === undefined ? 1 : p.gain);
      for (i = 0; i < n; i++) { outL[i] *= gain; outR[i] *= gain; }
      if (snd.chorus) { var ch = chorus(outL, outR, sr, snd.chorus); outL = ch[0]; outR = ch[1]; }
      if (p.pan) pan(outL, outR, p.pan);
      mixInto(busL, outL, 1); mixInto(busR, outR, 1);
      if (o.onProgress) o.onProgress((idx + 1) / (parts.length + 1));
    });
    var mv = master.volume === undefined ? .75 : master.volume;
    for (var k = 0; k < n; k++) { busL[k] *= mv; busR[k] *= mv; }
    var rev = C.reverbIR(sr, 2.2);
    /* ブラウザの残響（ConvolverNode）は応答を自動で正規化するので、仕様と同じ計算で合わせる */
    var pw = 0;
    rev.forEach(function (ch) { for (var q = 0; q < ch.length; q++) pw += ch[q] * ch[q]; });
    pw = Math.sqrt(pw / (2 * rev[0].length));
    var sc = 1 / Math.max(.000125, pw) * .00125 * 44100 / sr;
    rev.forEach(function (ch) { for (var q = 0; q < ch.length; q++) ch[q] *= sc; });
    var wl = convolve(busL, rev[0]), wr = convolve(busR, rev[1]), wet = master.reverb === undefined ? .16 : master.reverb;
    compressor(busL, busR, sr, { threshold:-16, ratio:2.5, knee:8, attack:.015, release:.2 });
    compressor(busL, busR, sr, { threshold:-3, ratio:20, knee:0, attack:.002, release:.1, peak:true });
    mixInto(busL, wl, wet); mixInto(busR, wr, wet);
    if (o.onProgress) o.onProgress(1);
    return { L:busL, R:busR, sampleRate:sr };
  }

  root.mixer = { render:render, convolve:convolve, fft:fft };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
