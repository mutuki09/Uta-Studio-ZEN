/* blueprint.js — AI設計図。作曲（構成・コード・メロディ・編成・見せ場）をAIに書いてもらい、
   このアプリは物理モデル音源で演奏するだけ、という分担のための入出力。
   ・アプリは外へ通信しない。指示文のコピーと、返ってきたJSONの貼り付けは人が行う。
   ・伴奏の細かい弾き方は arrange.js が、指定された楽器・弾き方・出番で組む。 */
(function (root) {
  "use strict";
  var T = root.theory, INS = root.instruments, SPB = 16;
  var FORMAT = "uta-studio-2/blueprint";
  var KINDS = ["intro", "verseA", "verseB", "chorus", "bridge", "outro", "ending"];
  var GROOVES = ["ballad", "eight", "rock", "sixteen", "shuffle", "bossa", "funk", "march", "quiet"];
  var STYLES = ["auto", "pad", "piano", "ep", "acoustic", "clean", "crunch", "arp", "brass", "saw"];
  var WHENS = ["all", "build", "chorus", "verse"];
  var PC = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  var SUFFIX = { "":"maj", "M":"maj", "maj":"maj", "m":"min", "min":"min", "-":"min", "7":"dom7", "M7":"maj7", "maj7":"maj7", "△7":"maj7",
    "m7":"min7", "min7":"min7", "-7":"min7", "dim":"dim", "o":"dim", "dim7":"dim7", "o7":"dim7", "aug":"aug", "+":"aug", "sus4":"sus4", "sus":"sus4",
    "sus2":"sus2", "6":"sixth", "m6":"min6", "9":"dom9", "m9":"min9", "M9":"maj9", "maj9":"maj9", "add9":"add9", "madd9":"madd9", "7sus4":"sus47",
    "m7b5":"m7b5", "m7-5":"m7b5", "ø":"m7b5", "5":"power", "mM7":"minmaj7", "7b9":"dom7b9", "7(b9)":"dom7b9", "7#9":"dom7s9", "7(#9)":"dom7s9", "69":"sixth9", "6/9":"sixth9" };

  function fail(msg) { throw new Error(msg); }
  function pitchClass(s) {
    var m = String(s).trim().match(/^([A-Ga-g])([#♯b♭]?)/);
    if (!m) return null;
    var v = PC[m[1].toUpperCase()] + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0);
    return { pc:(v + 12) % 12, len:m[0].length };
  }
  function parseChord(text, where) {
    var s = String(text || "").trim(), slash = s.split("/"), head = pitchClass(slash[0]);
    if (!head) fail(where + "のコード「" + s + "」が読めません");
    var suf = slash[0].slice(head.len).replace(/\s/g, "");
    var type = SUFFIX[suf];
    if (!type) fail(where + "のコード「" + s + "」の種類（" + suf + "）に対応していません");
    var c = { root:head.pc, type:type };
    if (slash[1]) { var b = pitchClass(slash[1]); if (!b) fail(where + "の分数コード「" + s + "」が読めません"); c.bass = b.pc; }
    return c;
  }
  function parseNote(v, where) {
    if (typeof v === "number" && v >= 0 && v <= 127) return Math.round(v);
    var m = String(v).trim().match(/^([A-Ga-g][#♯b♭]?)(-?\d)$/), p = m && pitchClass(m[1]);
    if (!p) fail(where + "の音「" + v + "」が読めません（例：E4・Bb3・60）");
    return (+m[2] + 1) * 12 + p.pc;
  }
  function parseKey(v) {
    var s = String(v || "C").trim(), p = pitchClass(s);
    if (!p) fail("key「" + s + "」が読めません（例：C・Am・F#m・Eb）");
    var rest = s.slice(p.len).toLowerCase();
    return { root:p.pc, mode:/^(m|min|minor)$/.test(rest) ? "minor" : "major" };
  }
  function pick(list, v, def) { return list.indexOf(v) >= 0 ? v : def; }

  /** JSONの文字列 → 曲データ（compose.compose と同じ形）。おかしい所は日本語のエラーで止める */
  function read(text) {
    var cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    var d;
    try { d = JSON.parse(cleaned); } catch (e) { fail("JSONとして読めません。AIの返答から { から } までを貼ってください"); }
    if (!d || typeof d !== "object") fail("設計図の形ではありません");
    var bpm = Math.max(50, Math.min(200, Math.round(+d.bpm || 110)));
    var key = parseKey(d.key);
    if (!Array.isArray(d.sections) || !d.sections.length) fail("sections（構成）がありません");
    var sections = [], bar = 0;
    d.sections.forEach(function (s, i) {
      var kind = pick(KINDS, s && s.kind, null), bars = Math.round(+(s && s.bars));
      if (!kind) fail("sections[" + i + "] の kind は " + KINDS.join(" / ") + " のどれかにしてください");
      if (!(bars >= 1 && bars <= 64)) fail("sections[" + i + "] の bars は1〜64にしてください");
      sections.push({ kind:kind, start:bar, bars:bars }); bar += bars;
    });
    var total = bar;
    if (total > 160) fail("長すぎます（160小節まで）");
    if (!Array.isArray(d.chords)) fail("chords（小節ごとのコード）がありません");
    if (d.chords.length !== total) fail("chords の数（" + d.chords.length + "）が、sections の小節数の合計（" + total + "）と違います。1小節に1つずつ書いてください");
    var chords = d.chords.map(function (c, i) { return parseChord(c, (i + 1) + "小節目"); });
    if (!Array.isArray(d.melody) || !d.melody.length) fail("melody（歌メロ）がありません");
    var melody = d.melody.map(function (n, i) {
      var where = "melody[" + i + "]", b = Math.round(+n.bar), beat = +n.beat, len = +n.len;
      if (!(b >= 1 && b <= total)) fail(where + " の bar は1〜" + total + "にしてください");
      if (!(beat >= 1 && beat < 5)) fail(where + " の beat は1〜4.75（16分＝0.25刻み）にしてください");
      if (!(len > 0 && len <= 16)) fail(where + " の len（拍数）が変です");
      return { s:Math.round(((b - 1) * 4 + (beat - 1)) * 4), d:Math.max(1, Math.round(len * 4)), n:parseNote(n.note, where), text:String(n.lyric || "").trim(), line:Number.isFinite(+n.line) ? +n.line : null };
    }).sort(function (a, b) { return a.s - b.s; });
    for (var i = 1; i < melody.length; i++) {
      if (melody[i].s < melody[i - 1].s + melody[i - 1].d) melody[i - 1].d = Math.max(1, melody[i].s - melody[i - 1].s);
      if (melody[i].s === melody[i - 1].s) fail("melody に同じ位置の音が重なっています（" + (Math.floor(melody[i].s / SPB) + 1) + "小節目）");
    }
    /* 歌のフレーズ（行）の番号：指定が無ければ、2拍以上の休みで区切る */
    var line = 0;
    melody.forEach(function (n, i) {
      if (n.line === null) { if (i && n.s - (melody[i - 1].s + melody[i - 1].d) >= 8) line++; n.line = line; }
    });
    var ins = d.instruments || {}, okIns = function (id, role, def) { var it = INS.LIST.filter(function (x) { return x.id === id; })[0]; return it && (role === "bass" ? it.bassSound : role === "comp" ? it.compSound : it.melody) ? id : def; };
    var layers = (Array.isArray(ins.layers) && ins.layers.length ? ins.layers : [{ ins:"piano" }]).slice(0, 5).map(function (l) {
      return { ins:okIns(l.ins, "comp", "piano"), style:pick(STYLES, l.style, "auto"), when:pick(WHENS, l.when, "all"), vol:Math.max(0, Math.min(1.5, l.vol === undefined ? 1 : +l.vol)) };
    });
    var instruments = { melody:okIns(ins.melody, "melody", "piano"), comp:layers[0].ins, bass:okIns(ins.bass, "bass", "fingerbass"),
      kit:INS.KITS.some(function (k) { return k.id === ins.kit; }) ? ins.kit : "standard", layers:layers };
    var events = [];
    ["kime", "break"].forEach(function (type) {
      (Array.isArray(d[type]) ? d[type] : []).forEach(function (b) { b = Math.round(+b); if (b >= 1 && b <= total) events.push({ bar:b - 1, type:type }); });
    });
    var song = { title:String(d.title || "AI設計図の曲").slice(0, 60), bpm:bpm, key:key, groove:pick(GROOVES, d.groove, "eight"), profile:"blueprint",
      sections:sections, chords:chords, melody:melody, bars:total, totalSteps:total * SPB, instruments:instruments, blueprint:true,
      forcedEvents:Array.isArray(d.kime) || Array.isArray(d["break"]) ? events : null, lyricsText:String(d.lyrics || "") };
    var unsung = melody.filter(function (n) { return !n.text; }).length;
    return { song:song, warnings:unsung ? ["歌詞の無い音が" + unsung + "個あります（MusicXMLの書き出し前に直してください）"] : [] };
  }

  /** AIに渡す指示文。楽器の一覧などは楽器表から作るので、楽器を増やしても自動で反映される */
  function prompt(opts) {
    var o = opts || {}, list = function (role) { return INS.forRole(role).map(function (it) { return it.id + "（" + it.name + "）"; }).join("、"); };
    return [
      "あなたは日本のポップスの作曲・編曲家です。次の歌詞で1曲作り、「歌スタジオ 2」用の設計図JSONだけを返してください（説明文は不要）。",
      "",
      "【歌詞】",
      o.lyrics || "（ここに歌詞）",
      "",
      "【作り方の目安】" + (o.moodNote ? "雰囲気：" + o.moodNote + "。" : ""),
      "・構成は 前奏→Aメロ→Bメロ→サビ→後奏→終止 を基本に。サビにいちばん印象的なメロディ（フック）を置き、前奏はサビの頭を楽器で予告する。",
      "・メロディは歌いやすく：音域は C4〜F5 くらい、Aメロは低め、サビで高く。強拍は和音の音、跳躍のあとは反対向きに戻る、同じ動機をくり返して変化させる。",
      "・リズムは8分だけにせず、休符・食い（裏拍の入り）・のばす音を混ぜる。言葉のアクセントと拍を合わせる。",
      "・1音に歌詞1文字（ひらがな1モーラ。「きゃ」などは1音、「ー」は前の音をのばす音、「ん」「っ」も1音で可）。",
      "・サビの前の小節にキメ（全員で同じリズムを鳴らす）かブレイク（後半で止める）を入れると盛り上がる。",
      "",
      "【JSONの形】",
      JSON.stringify({ format:FORMAT, version:1, title:"曲名", bpm:120, key:"C", groove:"eight",
        instruments:{ melody:"popbrass", bass:"fingerbass", kit:"standard",
          layers:[{ ins:"crunch", style:"auto", when:"all" }, { ins:"popbrass", style:"brass", when:"build" }, { ins:"strings", style:"pad", when:"chorus", vol:.8 }] },
        sections:[{ kind:"intro", bars:4 }, { kind:"verseA", bars:8 }, { kind:"verseB", bars:4 }, { kind:"chorus", bars:8 }, { kind:"outro", bars:2 }, { kind:"ending", bars:1 }],
        chords:["C", "G/B", "Am7", "Fmaj7", "…（小節の数だけ。sections の bars の合計と同じ数）"],
        melody:[{ bar:5, beat:1, len:0.5, note:"E4", lyric:"き", line:0 }, { bar:5, beat:1.5, len:0.5, note:"G4", lyric:"み", line:0 }],
        kime:[16], "break":[], lyrics:"（使った歌詞）" }, null, 1),
      "",
      "【決まり】",
      "・bar は1から数える小節番号、beat は小節内の拍（1〜4.75、16分＝0.25刻み）、len は長さ（拍。0.25＝16分、1＝4分）。4/4拍子。",
      "・note は E4・Bb3 のような音名（C4＝ド）。line は歌詞の行番号（0から）。",
      "・chords は1小節に1つ。使える種類：C, Cm, C7, Cmaj7, Cm7, Cdim, Cdim7, Caug, Csus4, Csus2, C6, Cm6, C9, Cm9, Cmaj9, Cadd9, C7sus4, Cm7b5, C5, 分数コード（C/E）。",
      "・key は C・Am・F#m・Eb など。groove：" + GROOVES.join(" / ") + "。",
      "・sections の kind：" + KINDS.join(" / ") + "（ending は最後の1小節、主和音でのばして終わる）。",
      "・kime / break：その演出を入れる小節番号の配列（省略するとアプリが自動で決める）。",
      "・instruments.melody（歌メロを鳴らす楽器）：" + list("melody"),
      "・instruments.layers[].ins（和音を鳴らす楽器、1〜5個）：" + list("comp"),
      "・instruments.layers[].style（弾き方）：" + STYLES.join(" / ") + "（auto＝楽器に合う弾き方）。when（出番）：" + WHENS.join(" / ") + "（build＝Bメロから）。",
      "・instruments.bass：" + list("bass"),
      "・instruments.kit：" + INS.KITS.map(function (k) { return k.id; }).join(" / ")
    ].join("\n");
  }

  /* 見本：初期の歌詞で書いた設計図（Claude が作曲）。[小節, 拍, 長さ(拍), 音, 歌詞, 行] */
  var SAMPLE_NOTES = [
    [5,1.5,.5,"F#4","き",0],[5,2,.5,"A4","み",0],[5,2.5,1,"A4","と",0],[5,3.5,.5,"B4","あ",0],[5,4,.5,"A4","る",0],[5,4.5,.5,"F#4","い",0],
    [6,1,2,"E4","た",0],[6,3.5,.5,"E4","か",0],[6,4,.5,"F#4","え",0],[6,4.5,.5,"A4","り",0],[7,1,1,"B4","み",0],[7,2,2.5,"F#4","ち",0],
    [9,1.5,.5,"G4","そ",1],[9,2,.5,"B4","ら",1],[9,2.5,1,"B4","が",1],[9,3.5,.5,"A4","す",1],[9,4,.5,"B4","こ",1],[9,4.5,.5,"D5","し",1],
    [10,1,1,"D5","だ",1],[10,2,1.5,"A4","け",1],[10,3.5,.5,"F#4","と",1],[10,4,.5,"G4","お",1],[10,4.5,.5,"A4","かっ",1],[11,1,2,"G4","た",1],
    [13,1,.5,"B4","こ",2],[13,1.5,.5,"B4","と",2],[13,2,.5,"C#5","ば",2],[13,2.5,1,"D5","に",2],[13,3.5,.5,"C#5","で",2],[13,4,.5,"B4","き",2],[13,4.5,.5,"A4","な",2],
    [14,1,2,"A4","い",2],[14,3.5,.5,"F#4","き",2],[14,4,.5,"A4","も",2],[14,4.5,.5,"C#5","ち",2],[15,1,3,"B4","が",2],
    [17,1.5,.5,"G4","ゆっ",3],[17,2,.5,"G4","く",3],[17,2.5,.5,"A4","り",3],[17,3,1,"B4","ふ",3],[17,4,.5,"C#5","く",3],[17,4.5,.5,"D5","ら",3],
    [18,1,1,"C#5","ん",3],[18,2,5,"A4","で",3],
    [21,1,1,"D5","て",4],[21,2,.5,"D5","を",4],[21,2.5,.5,"E5","の",4],[21,3,1,"F#5","ば",4],[21,4,.5,"E5","し",4],[21,4.5,.5,"D5","て",4],
    [22,1,2,"E5","も",4],[22,3.5,.5,"C#5","と",4],[22,4,.5,"D5","ど",4],[22,4.5,.5,"E5","か",4],[23,1,1,"F#5","な",4],[23,2,2.5,"E5","い",4],
    [25,1,.5,"D5","そ",5],[25,1.5,.5,"D5","れ",5],[25,2,.5,"E5","で",5],[25,2.5,1,"F#5","も",5],[25,3.5,.5,"E5","あ",5],[25,4,.5,"D5","し",5],[25,4.5,.5,"B4","た",5],
    [26,1,1.5,"C#5","を",5],[26,2.5,.5,"A4","し",5],[26,3,.5,"B4","ん",5],[26,3.5,.5,"C#5","じ",5],[26,4,1,"D5","て",5],[27,1,3,"D5","る",5],
    [29,1,.5,"B4","い",6],[29,1.5,.5,"D5","つ",6],[29,2,1,"D5","か",6],[29,3,.5,"E5","ま",6],[29,3.5,1.5,"D5","た",6],
    [30,1.5,.5,"E5","あ",6],[30,2,.5,"E5","え",6],[30,2.5,1,"F#5","る",6],[30,3.5,.5,"E5","よ",6],[30,4,1,"D5","う",6],[31,1,2.5,"C#5","に",6],
    [33,1,.5,"B4","こ",7],[33,1.5,.5,"D5","の",7],[33,2,1,"E5","う",7],[33,3,1,"F#5","た",7],[33,4,1,"E5","を",7],
    [34,1,1,"A4","う",7],[34,2,1,"C#5","た",7],[34,3,2,"E5","う",7],[35,1,6,"D5","よ",7]
  ];
  var SAMPLE = { format:FORMAT, version:1, title:"帰り道のブラス", bpm:148, key:"D", groove:"eight",
    instruments:{ melody:"popbrass", bass:"pickbass", kit:"standard",
      layers:[{ ins:"aguitar", style:"auto", when:"all" }, { ins:"popbrass", style:"brass", when:"build", vol:.9 }, { ins:"strings", style:"pad", when:"chorus", vol:.75 }] },
    sections:[{ kind:"intro", bars:4 }, { kind:"verseA", bars:8 }, { kind:"verseB", bars:8 }, { kind:"chorus", bars:16 }, { kind:"outro", bars:2 }, { kind:"ending", bars:1 }],
    chords:["G", "A", "F#m", "Bm", "D", "A/C#", "Bm", "F#m", "G", "D/F#", "Em", "A", "Bm", "F#m", "G", "D", "Em", "F#m", "G", "A",
      "G", "A", "F#m", "Bm", "G", "A", "D", "D", "G", "A", "F#m", "Bm", "Em7", "A7", "D", "D", "G", "A", "D"],
    melody:SAMPLE_NOTES.map(function (x) { return { bar:x[0], beat:x[1], len:x[2], note:x[3], lyric:x[4], line:x[5] }; }),
    kime:[4, 20, 36], "break":[12],
    lyrics:"[Aメロ]\n君と歩(ある)いた 帰(かえ)り道(みち)\n空がすこしだけ とおかった\n[Bメロ]\n言葉にできない 気持ちが\nゆっくりふくらんで\n[サビ]\n手をのばしても とどかない\nそれでも明日(あした)を 信(しん)じてる\nいつかまた 会えるように\nこの歌を うたうよ" };

  root.blueprint = { read:read, prompt:prompt, SAMPLE:SAMPLE, FORMAT:FORMAT, parseChord:parseChord, parseNote:parseNote };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
