/* app.js — 画面。歌詞 → 雰囲気 → 3案 → 調整 → 保存。
   曲の中身は compose.js（構成・コード・メロディ）と arrange.js（伴奏）が作り、
   音は engine/player.js（物理モデル音源）が鳴らす。ここは状態を持って、つなぐだけ。 */
(function (US) {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var T = US.theory, INS = US.instruments, SPB = 16;
  var KEYS = ["C", "C♯/D♭", "D", "E♭", "E", "F", "F♯/G♭", "G", "A♭", "A", "B♭", "B"];
  var RANGES = { low:{ lo:52, hi:72 }, mid:{ lo:57, hi:77 }, high:{ lo:62, hi:81 } };
  var PART_NAMES = { melody:"メロディ", comp:"和音", bass:"ベース", drums:"ドラム", master:"全体" };

  var state = { instrumental:false, length:"medium", moodId:"shittori", keyRoot:0, bpm:76, range:"mid", seed:20261010, ins:null, groove:null, active:0, volumes:{ master:.75, melody:1, comp:1, bass:1, drums:1 } };
  var cands = [], song = null, playing = false, head = -1;

  function toast(msg) { var t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2600); }
  function mood() { return US.moods.byId(state.moodId); }
  function fmtTime(sec) { sec = Math.max(0, sec); return Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0"); }
  function option(sel, value, text, group) { var o = document.createElement("option"); o.value = value; o.textContent = text; (group || sel).appendChild(o); }
  function fillInstruments(sel, role) {
    sel.innerHTML = "";
    var groups = {};
    INS.forRole(role).forEach(function (it) {
      if (!groups[it.group]) { groups[it.group] = document.createElement("optgroup"); groups[it.group].label = it.group; sel.appendChild(groups[it.group]); }
      option(sel, it.id, it.name, groups[it.group]);
    });
  }

  /* ---------- 雰囲気・調・速さ ---------- */
  function buildMoods() {
    var box = $("moods");
    US.moods.MOODS.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "mood"; b.dataset.id = m.id;
      b.innerHTML = "<strong></strong><small></small>";
      b.querySelector("strong").textContent = m.name; b.querySelector("small").textContent = m.note + "・" + m.bpm + " BPM";
      b.addEventListener("click", function () { selectMood(m.id); });
      box.appendChild(b);
    });
  }
  function selectMood(id) {
    state.moodId = id; state.bpm = mood().bpm; state.ins = null; state.insList = null; state.groove = null;
    $("bpm").value = state.bpm; $("bpmOut").textContent = state.bpm;
    Array.prototype.forEach.call($("moods").children, function (b) { b.setAttribute("aria-pressed", b.dataset.id === id ? "true" : "false"); });
  }

  /* ---------- 作曲 ---------- */
  function make(fresh) {
    stop();
    /* 歌詞なし（インスト）のときは、歌詞の代わりにフレーズの長さと区切りを作る */
    var L = state.instrumental ? US.lyrics.instrumental({ length:state.length, seed:state.seed }) : US.lyrics.parse($("lyrics").value);
    $("warn").hidden = !L.unknown.length;
    $("warn").textContent = L.unknown.length ? "読みが分からない字：" + L.unknown.join(" ") + "　→ 漢字(かんじ) のように読みを書いてください" : "";
    if (!L.lines.length) { toast("歌詞を1行以上書いてください"); return; }
    if (fresh) state.seed = (state.seed + 104729) >>> 0;
    var m = mood();
    /* 案ごとに別の編成：Aは雰囲気の標準、BとCは組み合わせ違い（歌メロの楽器も変える） */
    if (!state.insList) {
      var a = US.moods.defaultEnsemble(m), b = US.moods.variantEnsemble(m, state.seed + 11, [a.melody]);
      state.insList = [a, b, US.moods.variantEnsemble(m, state.seed + 23, [a.melody, b.melody])];
    }
    state.groove = state.groove || m.groove;
    cands = US.compose.PROFILES.map(function (p, i) {
      var s = US.compose.compose({ lyrics:L, mood:m, key:{ root:state.keyRoot, mode:m.mode }, bpm:state.bpm, range:RANGES[state.range],
        seed:state.seed + i * 7919, profile:p, title:$("title").value });
      s.groove = state.groove;
      s.instruments = JSON.parse(JSON.stringify(state.insList[i]));
      US.arrange.arrange(s, { seed:state.seed + i });
      s.lyricsText = state.instrumental ? "" : $("lyrics").value; s.instrumental = state.instrumental;
      return s;
    });
    state.active = Math.min(state.active, 2);
    song = cands[state.active];
    state.ins = state.insList[state.active];
    $("studio").hidden = false;
    renderAll();
    $("status").textContent = "3案できました。A・B・Cを聴き比べてください。";
    if (!fresh) $("studio").scrollIntoView({ behavior:"smooth", block:"start" });
  }
  /* AI設計図を開く：AIが書いた曲を1つの案として、指定の編成で演奏する */
  /* 自由スコアを開く：トラックをそのまま鳴らす（編曲はしない）。画面には旋律のトラックと区切りを表示 */
  function openScore(text) {
    var sc = US.score.read(text), bpb = sc.beatsPerBar;
    var lead = sc.tracks.filter(function (t) { return t.lead && !t.drums; })[0] || sc.tracks.filter(function (t) { return !t.drums; })[0];
    stop();
    var disp = { isScore:true, score:sc, title:sc.title, bpm:sc.bpm, key:{ root:0, mode:"major" }, bars:Math.ceil(sc.lengthBeats / bpb),
      totalSteps:Math.ceil(sc.lengthBeats * 4), chords:[], parts:{}, arrangement:null,
      sections:sc.sections.map(function (x, i, a) { return { kind:["verseA", "verseB", "chorus", "bridge"][i % 4], label:x.name, start:x.at / bpb, bars:((a[i + 1] ? a[i + 1].at : sc.lengthBeats) - x.at) / bpb }; }),
      melody:lead ? lead.notes.map(function (n, i) { return { s:n.beat * 4, d:n.len * 4, n:n.notes[n.notes.length - 1], text:n.lyric, line:0 }; }) : [] };
    state.blueprintText = typeof text === "string" ? text : JSON.stringify(text);
    cands = [disp]; state.insList = [null]; state.ins = null; state.active = 0; song = disp;
    $("title").value = sc.title; $("bpm").value = Math.round(sc.bpm); $("bpmOut").textContent = Math.round(sc.bpm);
    $("studio").hidden = false;
    renderAll();
    $("status").textContent = "自由スコアを開きました（" + sc.tracks.length + "トラック・" + sc.seconds.toFixed(1) + "秒）。楽器と編曲はスコアの指定どおりです。";
    return { warnings:[] };
  }
  function openBlueprint(text) {
    if (/"format"\s*:\s*"uta-studio-2\/score"/.test(text)) return openScore(text);
    var r = US.blueprint.read(text), s = r.song;
    stop();
    state.blueprintText = text; state.groove = s.groove; state.bpm = s.bpm; state.keyRoot = s.key.root;
    $("bpm").value = s.bpm; $("bpmOut").textContent = s.bpm; $("keySel").value = s.key.root; $("title").value = s.title;
    US.arrange.arrange(s, { seed:state.seed });
    cands = [s]; state.insList = [s.instruments]; state.active = 0; song = s; state.ins = s.instruments;
    $("studio").hidden = false;
    renderAll();
    $("status").textContent = "AI設計図の曲を開きました（" + s.bars + "小節）。" + r.warnings.join(" ");
    return r;
  }
  function profileOf(i) {
    if (cands[i] && cands[i].isScore) return { letter:"譜", name:"自由スコア", note:"トラックをそのまま演奏" };
    return cands[i] && cands[i].blueprint ? { letter:"AI", name:"AI設計図", note:"AIが作曲した設計図" } : US.compose.PROFILES[i];
  }

  /* 楽器を変えたら、いま選んでいる案だけ組み直す。ノリ・キーは全部の案へ（メロディはそのまま） */
  function rearrange(all) {
    stop();
    cands.forEach(function (s, i) {
      if (!all && i !== state.active) return;
      s.instruments = JSON.parse(JSON.stringify(state.insList[i])); s.groove = state.groove; US.arrange.arrange(s, { seed:state.seed + i });
    });
    renderAll();
  }
  function insName(id) { return INS.byId(id).name.replace(/（.*?）/g, ""); }
  function ensembleText(e) {
    return "歌メロ：" + insName(e.melody) + " ／ " + e.layers.map(function (l) { return insName(l.ins); }).join("・") + " ／ " + insName(e.bass);
  }
  /* いまの案の編成を、別の組み合わせに入れ替える（メロディ・コードはそのまま） */
  function reroll() {
    var m = mood(), cur = state.insList[state.active];
    var e = US.moods.variantEnsemble(m, (Math.random() * 4294967296) >>> 0, [cur.melody]);
    state.insList[state.active] = e; state.ins = e;
    rearrange(false);
    toast(profileOf(state.active).letter + "案の編成：" + ensembleText(e));
  }
  /* 和音の楽器だけを入れ替える（歌メロ・ベース・ドラムと層の数はそのまま） */
  function rerollLayers() {
    var m = mood(), cur = state.ins, n = cur.layers.length, rnd = function () { return (Math.random() * 4294967296) >>> 0; };
    var L = US.moods.variantEnsemble(m, rnd(), [cur.melody]).layers.slice(0, n);
    while (L.length < n) L.push(US.moods.extraLayer(m, rnd(), [cur.melody].concat(L.map(function (l) { return l.ins; }))));
    cur.layers = L; cur.comp = L[0].ins;
    rearrange(false);
    toast("和音の楽器：" + L.map(function (l) { return insName(l.ins); }).join("・"));
  }
  /* 雰囲気に合う楽器を1つ足す（いま鳴っている楽器とは別のもの） */
  function addLayer() {
    if (!state.ins || state.ins.layers.length >= 5) return;
    var used = [state.ins.melody].concat(state.ins.layers.map(function (l) { return l.ins; }));
    var l = US.moods.extraLayer(mood(), (Math.random() * 4294967296) >>> 0, used);
    state.ins.layers.push(l);
    rearrange(false);
    toast(insName(l.ins) + "を足しました（楽器・弾き方・出番は行で変えられます）");
  }
  function transpose(d) {
    state.keyRoot = (state.keyRoot + d + 12) % 12;
    $("keySel").value = state.keyRoot;
    cands.forEach(function (s) {
      s.key = { root:state.keyRoot, mode:s.key.mode };
      s.melody.forEach(function (n) { n.n += d; });
      s.chords = s.chords.map(function (c) { return { root:(c.root + d + 12) % 12, type:c.type }; });
    });
    rearrange(true);
    toast("キーを" + KEYS[state.keyRoot] + "にしました");
  }

  /* ---------- 画面 ---------- */
  function renderAll() {
    $("songName").textContent = $("title").value || "まだ名前のない曲";
    if (edit.song !== song) { edit.sel = -1; edit.song = song; }
    renderCands(); syncControls(); drawRoll(); updateEditBar();
  }
  function renderCands() {
    var box = $("cands"); box.innerHTML = "";
    cands.forEach(function (s, i) {
      var p = profileOf(i), b = document.createElement("button");
      b.type = "button"; b.className = "cand"; b.setAttribute("aria-pressed", i === state.active ? "true" : "false");
      var sec = s.bars * 4 * 60 / s.bpm;
      b.innerHTML = "<b></b><span><strong></strong><small></small></span>";
      b.querySelector("b").textContent = p.letter;
      b.querySelector("strong").textContent = p.name + "（" + fmtTime(sec) + "）";
      b.querySelector("small").textContent = s.isScore ? s.score.tracks.map(function (t) { return t.name; }).join("・") : ensembleText(state.insList[i]);
      b.title = p.note;
      b.addEventListener("click", function () { state.active = i; song = cands[i]; state.ins = state.insList[i]; renderAll(); play(0); });
      box.appendChild(b);
    });
  }
  function syncControls() {
    $("studio").classList.toggle("score-mode", !!(song && song.isScore));
    if (song && song.isScore) { $("arrNote").textContent = ""; return; }
    $("insMelody").value = state.ins.melody; $("insBass").value = state.ins.bass; $("insKit").value = state.ins.kit;
    $("grooveSel").value = state.groove;
    $("forCand").textContent = "（" + profileOf(state.active).letter + "案の楽器）";
    renderLayers();
    var a = song && song.arrangement;
    var STY = { piano:"刻み・分散和音", ep:"シンコペーションの刻み", acoustic:"ストローク／アルペジオ", clean:"カッティング", crunch:"パワーコード", brass:"キメ", arp:"アルペジオ", saw:"裏打ち→サビで伸ばす", pad:"のばす" };
    $("arrNote").textContent = a ? "いまの弾き方：和音＝" + a.layers.map(function (x) { return STY[x] || x; }).join("＋") +
      " ／ ベース＝" + ({ root:"ルート", two:"2分", eighth:"8分", pump:"16分", funk:"スラップ・ファンク", synth:"オクターブ", boogie:"ブギー", walk:"ウォーキング", march:"マーチ" }[a.bass] || a.bass) : "";
  }

  /* 和音の層：楽器・弾き方・出番・音量。行を足すとその楽器が重なる（最大5層） */
  function renderLayers() {
    var box = $("layerList"), L = state.ins.layers;
    box.innerHTML = "";
    L.forEach(function (l, i) {
      var row = document.createElement("div"); row.className = "layer";
      var ins = document.createElement("select"); ins.setAttribute("aria-label", (i + 1) + "層目の楽器"); fillInstruments(ins, "comp"); ins.value = l.ins;
      var sty = document.createElement("select"); sty.setAttribute("aria-label", (i + 1) + "層目の弾き方"); US.arrange.STYLES.forEach(function (x) { option(sty, x[0], x[1]); }); sty.value = l.style || "auto";
      var when = document.createElement("select"); when.setAttribute("aria-label", (i + 1) + "層目の出番"); US.arrange.WHEN.forEach(function (x) { option(when, x[0], x[1]); }); when.value = l.when || "all";
      var vol = document.createElement("input"); vol.type = "range"; vol.min = 0; vol.max = 1.5; vol.step = .05; vol.value = l.vol === undefined ? 1 : l.vol; vol.setAttribute("aria-label", (i + 1) + "層目の音量");
      var del = document.createElement("button"); del.type = "button"; del.className = "ghost del"; del.textContent = "×"; del.title = "この楽器を外す"; del.disabled = L.length <= 1;
      ins.addEventListener("change", function () { l.ins = this.value; if (i === 0) state.ins.comp = this.value; rearrange(); });
      sty.addEventListener("change", function () { l.style = this.value; rearrange(); });
      when.addEventListener("change", function () { l.when = this.value; rearrange(); });
      vol.addEventListener("change", function () { l.vol = +this.value; rearrange(); });
      del.addEventListener("click", function () { L.splice(i, 1); state.ins.comp = L[0].ins; rearrange(); });
      [ins, sty, when, vol, del].forEach(function (el) { row.appendChild(el); });
      box.appendChild(row);
    });
    $("addLayer").disabled = L.length >= 5;
  }

  /* 曲の地図：セクション帯・コード・メロディ（歌詞つき）・再生位置 */
  var BAR_W = 150, ROLL_H = 300;
  function drawRoll() {
    var cv = $("roll"), g = cv.getContext("2d"), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (!song) return;
    var W = Math.max($("rollWrap").clientWidth, song.bars * BAR_W + 40), H = ROLL_H;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px"; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#120f0c"; g.fillRect(0, 0, W, H);
    var x0 = 20, x = function (step) { return x0 + step / SPB * BAR_W; }, css = getComputedStyle(document.documentElement);
    var lo = 127, hi = 0;
    song.melody.forEach(function (n) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); });
    lo -= 2; hi += 2;
    /* ドラッグ中は縦の目盛りを固定する（動かすたびに画面が伸び縮みしないように） */
    if (edit.drag) { lo = edit.geom.lo; hi = edit.geom.hi; }
    var top = 60, bottom = H - 44, y = function (m) { return bottom - (m - lo) / Math.max(1, hi - lo) * (bottom - top); };
    edit.geom = { lo:lo, hi:hi, top:top, bottom:bottom, x0:x0 };
    var NAMES = { intro:"前奏", verseA:"Aメロ", verseB:"Bメロ", chorus:"サビ", bridge:"Cメロ", outro:"後奏", ending:"終止" };
    song.sections.forEach(function (s) {
      g.fillStyle = css.getPropertyValue("--" + s.kind).trim() || "#555";
      g.globalAlpha = .9; g.fillRect(x(s.start * SPB) + 1, 6, s.bars * BAR_W - 2, 20); g.globalAlpha = .07;
      g.fillRect(x(s.start * SPB) + 1, 28, s.bars * BAR_W - 2, H - 34); g.globalAlpha = 1;
      g.fillStyle = "#fff"; g.font = "700 12px sans-serif"; g.textBaseline = "middle"; g.fillText(s.label || NAMES[s.kind] || s.kind, x(s.start * SPB) + 7, 16);
    });
    for (var b = 0; b <= song.bars; b++) { g.strokeStyle = b % 4 ? "#251e17" : "#3a3027"; g.beginPath(); g.moveTo(x(b * SPB) + .5, 28); g.lineTo(x(b * SPB) + .5, H); g.stroke(); }
    g.font = "600 11px ui-monospace,monospace"; g.fillStyle = "#d6a44e";
    var flats = [1, 3, 5, 8, 10].indexOf(song.key.root) >= 0;
    song.chords.forEach(function (c, b) { g.fillText(T.chordName({ root:c.root, type:c.type, preferFlats:flats }), x(b * SPB) + 5, 42); });
    /* 前奏のフック（薄く） */
    ((song.parts && song.parts.answer && song.parts.answer.notes) || []).forEach(function (n) { g.fillStyle = "rgba(127,180,138,.75)"; g.fillRect(x(n.s), y(n.n) - 2.5, Math.max(3, n.d / SPB * BAR_W - 1), 5); });
    ((song.parts && song.parts.lead) || []).forEach(function (n) { g.fillStyle = "rgba(214,164,78,.35)"; g.fillRect(x(n.s), y(n.n) - 3, Math.max(3, n.d / SPB * BAR_W - 1), 6); });
    /* 歌詞は下の段に、音符の位置にそろえて並べる */
    g.fillStyle = "#1b1612"; g.fillRect(0, H - 30, W, 30);
    g.font = "13px sans-serif"; g.textBaseline = "middle";
    song.melody.forEach(function (n, i) {
      var on = head >= n.s && head < n.s + n.d, sel = i === edit.sel, w = Math.max(3, n.d / SPB * BAR_W - 1.5);
      g.fillStyle = sel ? "#ffffff" : on ? "#fff3d6" : "#d6a44e"; g.fillRect(x(n.s), y(n.n) - 4, w, 8);
      if (sel) {
        g.strokeStyle = "#7fb48a"; g.lineWidth = 2; g.strokeRect(x(n.s) - 2, y(n.n) - 6, w + 4, 12); g.lineWidth = 1;
        g.fillStyle = "#7fb48a"; g.font = "700 11px ui-monospace,monospace"; g.fillText(T.midiName(n.n), x(n.s), y(n.n) - 14); g.font = "13px sans-serif";
      }
      g.fillStyle = sel ? "#7fb48a" : on ? "#ffffff" : "#cfc2ab"; g.fillText(n.text || "", x(n.s), H - 15);
    });
    if (head >= 0) { g.strokeStyle = "#efe5d4"; g.lineWidth = 2; g.beginPath(); g.moveTo(x(head), 28); g.lineTo(x(head), H); g.stroke(); g.lineWidth = 1; }
  }
  /* ---------- メロディの手直し ----------
     音符をドラッグで上下（調の音に吸い付く）。選んだ音はボタンや ↑↓ キーでも動かせる。
     何も選んでいなければ、ボタンはメロディ全体を動かす。直したら伴奏（掛け合い・前奏のフック）を組み直す。 */
  var edit = { sel:-1, drag:null, geom:null, undo:[] };
  function canEdit() { return song && !song.isScore && song.melody.length; }
  function snapshot() { edit.undo.push({ song:song, pitches:song.melody.map(function (n) { return n.n; }) }); if (edit.undo.length > 50) edit.undo.shift(); }
  function scaleStep(m, dir) { var k = song.key, x = m + dir; while (!T.inScale(x, k)) x += dir; return x; }
  function clampPitch(m) { return Math.max(36, Math.min(96, m)); }
  function afterEdit(msg) {
    var keep = edit.sel;
    rearrange(false); edit.sel = keep; drawRoll(); updateEditBar();
    if (msg) toast(msg);
  }
  function moveNotes(kind) {
    if (!canEdit()) return;
    snapshot();
    var list = edit.sel >= 0 ? [song.melody[edit.sel]] : song.melody;
    list.forEach(function (n) {
      n.n = clampPitch(kind === "octUp" ? n.n + 12 : kind === "octDown" ? n.n - 12 : scaleStep(n.n, kind === "up" ? 1 : -1));
    });
    afterEdit(edit.sel >= 0 ? "音を " + T.midiName(song.melody[edit.sel].n) + " にしました" : (kind === "up" || kind === "octUp" ? "メロディ全体を高くしました" : "メロディ全体を低くしました"));
  }
  function undoEdit() {
    var u = edit.undo.pop();
    if (!u || u.song !== song) { toast("戻せる手直しはありません"); return; }
    song.melody.forEach(function (n, i) { if (u.pitches[i] !== undefined) n.n = u.pitches[i]; });
    afterEdit("ひとつ前に戻しました");
  }
  function updateEditBar() {
    var on = canEdit(), n = on && edit.sel >= 0 ? song.melody[edit.sel] : null;
    $("editBar").hidden = !on;
    $("editTarget").textContent = n ? "選んだ音：" + (n.text ? "「" + n.text + "」" : "") + T.midiName(n.n) : "選んでいない時は全体を動かします";
    $("editClear").hidden = !n;
  }
  function hitNote(px, py) {
    if (!canEdit() || !edit.geom) return -1;
    var gm = edit.geom, step = (px - gm.x0) / BAR_W * SPB, best = -1, bd = 9;
    song.melody.forEach(function (n, i) {
      if (step < n.s - .3 || step > n.s + n.d + .3) return;
      var yy = gm.bottom - (n.n - gm.lo) / Math.max(1, gm.hi - gm.lo) * (gm.bottom - gm.top), dd = Math.abs(yy - py);
      if (dd < bd) { bd = dd; best = i; }
    });
    return best;
  }

  function follow() {
    var wrap = $("rollWrap"), px = 20 + head / SPB * BAR_W;
    if (px < wrap.scrollLeft + 40 || px > wrap.scrollLeft + wrap.clientWidth - 80) wrap.scrollLeft = px - 80;
  }

  /* ---------- 再生 ---------- */
  function play(fromBar) {
    if (!song) return;
    stop();
    $("status").textContent = "物理モデル音源を準備しています…";
    playing = true; $("playBtn").textContent = "■ 停止"; $("playBtn").setAttribute("aria-pressed", "true");
    US.player.play(song.isScore ? song.score : song, {
      fromStep:(fromBar || 0) * SPB,
      onStep:function (s) { head = s; $("pos").textContent = fmtTime(s / 4 * 60 / song.bpm); drawRoll(); follow(); $("status").textContent = "再生中（" + profileOf(state.active).letter + "案）"; },
      onEnd:function () { stop(); $("status").textContent = "最後まで再生しました。"; }
    }).catch(function (e) { stop(); $("status").textContent = "再生できませんでした：" + e.message; });
  }
  function stop() {
    US.player.stop(); playing = false; head = -1;
    $("playBtn").textContent = "▶ 再生"; $("playBtn").setAttribute("aria-pressed", "false");
    if (song) drawRoll();
  }

  /* ---------- 保存 ---------- */
  function fileName(ext) { return ($("title").value || "song").replace(/[\\/:*?"<>|]/g, "_") + ext; }
  function download(data, type, name) {
    var url = URL.createObjectURL(new Blob([data], { type:type })), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function saveState() {
    return { instrumental:state.instrumental, length:state.length, title:$("title").value, lyrics:$("lyrics").value, moodId:state.moodId, keyRoot:state.keyRoot, bpm:state.bpm, range:state.range,
      seed:state.seed, insList:state.insList, groove:state.groove, active:state.active, blueprintText:cands[0] && (cands[0].blueprint || cands[0].isScore) ? state.blueprintText : null };
  }
  function loadState(st) {
    $("title").value = st.title || ""; $("lyrics").value = st.lyrics;
    setMode(!!st.instrumental); state.length = st.length || "medium"; $("lengthSel").value = state.length;
    selectMood(US.moods.byId(st.moodId).id);
    state.keyRoot = +st.keyRoot || 0; state.bpm = +st.bpm || mood().bpm; state.range = RANGES[st.range] ? st.range : "mid";
    state.seed = st.seed >>> 0; state.insList = Array.isArray(st.insList) && st.insList.length === 3 ? st.insList : null; state.groove = st.groove || null; state.active = Math.max(0, Math.min(2, st.active | 0));
    $("keySel").value = state.keyRoot; $("rangeSel").value = state.range; $("bpm").value = state.bpm; $("bpmOut").textContent = state.bpm;
    if (st.blueprintText) { var ins = st.insList; openBlueprint(st.blueprintText); if (ins && ins[0]) { state.insList = [ins[0]]; state.ins = ins[0]; rearrange(false); } return; }
    make(false);
  }

  /* 歌もの ⇔ 歌詞なし の切り替え */
  function setMode(inst) {
    state.instrumental = inst;
    $("lyricBox").hidden = inst; $("instBox").hidden = !inst;
    $("h1").textContent = inst ? "曲の種類と長さ" : "歌詞を書く";
    Array.prototype.forEach.call(document.querySelectorAll("input[name=mode]"), function (r) { r.checked = (r.value === "inst") === inst; });
  }

  /* ---------- 組み立て ---------- */
  function init() {
    buildMoods(); selectMood(state.moodId);
    KEYS.forEach(function (k, i) { option($("keySel"), i, k); });
    fillInstruments($("insMelody"), "melody"); fillInstruments($("insBass"), "bass");
    INS.KITS.forEach(function (k) { option($("insKit"), k.id, k.name); });
    US.moods.GROOVES.forEach(function (g) { option($("grooveSel"), g.id, g.name); });
    ["master", "melody", "comp", "bass", "drums"].forEach(function (p) {
      var row = document.createElement("label"); row.className = "mix";
      row.innerHTML = "<span></span><input type='range' min='0' max='1.5' step='.01'><output></output>";
      row.querySelector("span").textContent = PART_NAMES[p];
      var inp = row.querySelector("input"), out = row.querySelector("output");
      inp.value = state.volumes[p]; out.textContent = Math.round(state.volumes[p] * 100) + "%";
      inp.addEventListener("input", function () { state.volumes[p] = +inp.value; out.textContent = Math.round(inp.value * 100) + "%"; US.player.setVolume(p, +inp.value); });
      $("mixer").appendChild(row);
    });

    Array.prototype.forEach.call(document.querySelectorAll("input[name=mode]"), function (r) { r.addEventListener("change", function () { setMode(this.value === "inst"); }); });
    $("lengthSel").addEventListener("change", function () { state.length = this.value; });
    $("keySel").addEventListener("change", function () { state.keyRoot = +this.value; });
    $("rangeSel").addEventListener("change", function () { state.range = this.value; });
    $("bpm").addEventListener("input", function () {
      state.bpm = +this.value; $("bpmOut").textContent = state.bpm;
      cands.forEach(function (s) { s.bpm = state.bpm; });
      if (song) renderCands();
    });
    $("makeBtn").addEventListener("click", function () { make(cands.length > 0); });
    $("playBtn").addEventListener("click", function () { if (playing) stop(); else play(0); });
    /* 曲の画面：音符を押してドラッグ＝高さを直す／音符以外を押す＝その小節から再生 */
    $("roll").addEventListener("pointerdown", function (e) {
      if (!song) return;
      var r = this.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, i = hitNote(px, py);
      if (i >= 0) {
        if (playing) stop();
        edit.sel = i; edit.drag = { i:i, y:py, from:song.melody[i].n, moved:false };
        snapshot();
        try { this.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど */ }
        drawRoll(); updateEditBar(); e.preventDefault(); return;
      }
      edit.down = { px:px, py:py };
    });
    $("roll").addEventListener("pointermove", function (e) {
      if (!edit.drag) return;
      var r = this.getBoundingClientRect(), gm = edit.geom, pxPerSemi = (gm.bottom - gm.top) / Math.max(1, gm.hi - gm.lo);
      var k = Math.round((edit.drag.y - (e.clientY - r.top)) / Math.max(3, pxPerSemi));
      var m = clampPitch(T.snapToScale(edit.drag.from + k, song.key));
      if (m !== song.melody[edit.drag.i].n) { song.melody[edit.drag.i].n = m; edit.drag.moved = true; drawRoll(); updateEditBar(); }
    });
    var endDrag = function () {
      if (!edit.drag) return;
      var d = edit.drag; edit.drag = null;
      if (d.moved) afterEdit("「" + (song.melody[d.i].text || "♪") + "」を " + T.midiName(song.melody[d.i].n) + " にしました");
      else { edit.undo.pop(); drawRoll(); }
    };
    $("roll").addEventListener("pointerup", function (e) {
      if (edit.drag) { endDrag(); return; }
      var down = edit.down; edit.down = null;
      if (!down || !song) return;
      var bar = Math.floor((down.px - 20) / BAR_W);
      if (edit.sel >= 0) { edit.sel = -1; drawRoll(); updateEditBar(); }
      if (bar >= 0 && bar < song.bars) play(bar);
    });
    $("roll").addEventListener("pointercancel", endDrag);
    [["editOctDown", "octDown"], ["editDown", "down"], ["editUp", "up"], ["editOctUp", "octUp"]].forEach(function (x) {
      $(x[0]).addEventListener("click", function () { moveNotes(x[1]); });
    });
    $("editUndo").addEventListener("click", undoEdit);
    $("editClear").addEventListener("click", function () { edit.sel = -1; drawRoll(); updateEditBar(); });
    document.addEventListener("keydown", function (e) {
      if (!canEdit() || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoEdit(); return; }
      if (edit.sel < 0) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); moveNotes(e.shiftKey ? (e.key === "ArrowUp" ? "octUp" : "octDown") : (e.key === "ArrowUp" ? "up" : "down")); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); edit.sel = Math.max(0, Math.min(song.melody.length - 1, edit.sel + (e.key === "ArrowRight" ? 1 : -1))); drawRoll(); updateEditBar(); }
      else if (e.key === "Escape") { edit.sel = -1; drawRoll(); updateEditBar(); }
    });
    $("addLayer").addEventListener("click", addLayer);
    $("rerollLayers").addEventListener("click", rerollLayers);
    [["insMelody", "melody"], ["insBass", "bass"], ["insKit", "kit"]].forEach(function (x) {
      $(x[0]).addEventListener("change", function () { state.ins[x[1]] = this.value; rearrange(); toast("楽器に合わせて伴奏を組み直しました"); });
    });
    $("rerollBtn").addEventListener("click", reroll);
    $("bpBtn").addEventListener("click", function () { $("bp").showModal(); });
    $("bpClose").addEventListener("click", function () { $("bp").close(); });
    /* 手本の曲：ファイルを読んでそのまま開く（index.html をファイルから直接開いた場合は読めないことがある） */
    $("bpExample").addEventListener("change", function () {
      var url = this.value; if (!url) return;
      fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }).then(function (t) {
        openBlueprint(t); $("bp").close(); toast("手本を開きました");
      }).catch(function () { $("bpStatus").textContent = "手本を読めませんでした（ブラウザがファイルを直接開いている場合は、examples フォルダの JSON を欄に貼ってください）"; });
      this.value = "";
    });
    $("bpSample").addEventListener("click", function () {
      $("bpText").value = JSON.stringify(US.blueprint.SAMPLE, null, 1);
      $("bpStatus").textContent = "見本（初期の歌詞で Claude が書いた設計図）を入れました。「この設計図で開く」で演奏できます。";
    });
    $("bpCopy").addEventListener("click", function () {
      var text = US.blueprint.prompt({ lyrics:state.instrumental ? "（歌詞なしのインスト曲・BGM。melody の lyric は書かなくてよい。旋律は楽器で弾く前提で、歌より音域や跳躍を自由にしてよい）" : $("lyrics").value, moodNote:mood().name + "（" + mood().note + "）・" + state.bpm + " BPM" });
      var done = function () { $("bpStatus").textContent = "指示文をコピーしました。AIのチャットに貼って送ってください。"; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { $("bpText").value = text; $("bpStatus").textContent = "コピーできなかったので、下の欄に入れました。全部選んでコピーしてください。"; });
      else { $("bpText").value = text; $("bpStatus").textContent = "下の欄の指示文をコピーしてください。"; }
    });
    $("bpOpen").addEventListener("click", function () {
      try { var r = openBlueprint($("bpText").value); $("bp").close(); toast((song.isScore ? "自由スコア" : "AI設計図") + "を開きました" + (r.warnings.length ? "（注意：" + r.warnings[0] + "）" : "")); }
      catch (e) { $("bpStatus").textContent = "開けませんでした：" + e.message; }
    });
    $("grooveSel").addEventListener("change", function () { state.groove = this.value; rearrange(true); toast("ノリを変えて組み直しました"); });
    $("keyDown").addEventListener("click", function () { transpose(-1); });
    $("keyUp").addEventListener("click", function () { transpose(1); });

    $("saveMidi").addEventListener("click", function () { download(song.isScore ? US.exporter.scoreMidi(song.score) : US.exporter.midi(song), "audio/midi", fileName(".mid")); toast("MIDIを保存しました"); });
    $("saveXml").addEventListener("click", function () {
      if (!song.melody.some(function (n) { return n.text; })) { toast("歌詞なしの曲は MusicXML（歌声用）を書き出せません。MIDI を使ってください"); return; }
      try { download(US.musicxml.build(song, song.bpm, $("title").value), "application/vnd.recordare.musicxml+xml", fileName(".musicxml")); toast("MusicXMLを保存しました"); }
      catch (e) { toast(e.message); }
    });
    $("saveWav").addEventListener("click", function () {
      stop(); $("status").textContent = "WAVを書き出しています（曲の長さぶん計算します）…";
      US.player.render(song.isScore ? song.score : song, {}).then(function (buf) { download(US.exporter.wav(buf), "audio/wav", fileName(".wav")); $("status").textContent = "WAVを保存しました。"; })
        .catch(function (e) { $("status").textContent = "書き出せませんでした：" + e.message; });
    });
    $("saveProj").addEventListener("click", function () { download(US.exporter.project(saveState()), "application/json", fileName(".utastudio.json")); toast("プロジェクトを保存しました"); });
    $("openBtn").addEventListener("click", function () { $("openFile").click(); });
    $("openFile").addEventListener("change", function () {
      var f = this.files[0]; if (!f) return;
      f.text().then(function (t) { loadState(US.exporter.readProject(t)); toast("プロジェクトを開きました"); }).catch(function (e) { toast(e.message); });
      this.value = "";
    });
    $("helpBtn").addEventListener("click", function () { $("help").showModal(); });
    $("helpClose").addEventListener("click", function () { $("help").close(); });
    window.addEventListener("resize", function () { if (song) drawRoll(); });
    $("keySel").value = state.keyRoot;
    US.app = { state:state, cands:function () { return cands; }, song:function () { return song; }, make:make, play:play, stop:stop };
  }
  init();
})(window.US);
