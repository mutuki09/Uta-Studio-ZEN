/* lyrics.js — 歌詞を「歌う単位」に分ける。
   ・かな1文字＝1音（小書きのかなは前とくっつく）、「ー」はのばす、「っ」は詰める、「ん」は1音
   ・漢字(かんじ) のように括弧で読みを書ける。よく使う漢字は自動で読む
   ・[Aメロ] [Bメロ] [サビ] のような行でセクションを指定できる（無ければ行の位置から決める）
   ・空白・読点は言葉の切れ目、改行は歌のフレーズの切れ目 */
(function (root) {
  "use strict";

  var SMALL = "ゃゅょぁぃぅぇぉャュョァィゥェォゎヮヵヶ";
  var LONG = "ー〜～－ｰ";
  var SOKUON = "っッ";
  var NASAL = "んン";
  var BREAKS = "、,。.　 ・！!？?";
  var PARTICLES = ["から", "まで", "より", "って", "には", "では", "ても", "でも", "は", "が", "を", "に", "で", "と", "へ", "の", "も", "や", "ね", "よ"];

  /* 歌詞によく出る漢字の読み（歌スタジオ ZEN から引き継ぎ）。読めないものは括弧で補ってもらう */
  var KANJI = {
    "空":"そら","夜":"よる","朝":"あさ","昼":"ひる","星":"ほし","月":"つき","日":"ひ","陽":"ひ",
    "光":"ひかり","影":"かげ","雨":"あめ","雪":"ゆき","風":"かぜ","雲":"くも","海":"うみ","山":"やま",
    "川":"かわ","花":"はな","木":"き","森":"もり","道":"みち","町":"まち","街":"まち","駅":"えき",
    "夏":"なつ","秋":"あき","冬":"ふゆ","春":"はる","今":"いま","明日":"あした","昨日":"きのう",
    "君":"きみ","僕":"ぼく","私":"わたし","俺":"おれ","君達":"きみたち","人":"ひと","心":"こころ",
    "声":"こえ","顔":"かお","目":"め","手":"て","指":"ゆび","胸":"むね","涙":"なみだ","夢":"ゆめ",
    "愛":"あい","恋":"こい","歌":"うた","音":"おと","色":"いろ","言葉":"ことば","名前":"なまえ",
    "時":"とき","時間":"じかん","季節":"きせつ","世界":"せかい","未来":"みらい","過去":"かこ",
    "季":"き","記憶":"きおく","約束":"やくそく","景色":"けしき","願":"ねが","想":"おも","思":"おも",
    "僕等":"ぼくら","僕ら":"ぼくら","私達":"わたしたち",
    "行":"い","来":"く","見":"み","聞":"き","知":"し","歩":"ある","走":"はし","飛":"と",
    "笑":"わら","泣":"な","待":"ま","会":"あ","帰":"かえ","立":"た",
    "電車":"でんしゃ","窓":"まど","部屋":"へや","扉":"とびら","鍵":"かぎ",
    "坂":"さか","橋":"はし","公園":"こうえん","教室":"きょうしつ","制服":"せいふく","放課後":"ほうかご",
    "青":"あお","赤":"あか","白":"しろ","黒":"くろ","蒼":"あお",
    "遠":"とお","近":"ちか","高":"たか","低":"ひく","長":"なが","短":"みじか","新":"あたら","古":"ふる",
    "優":"やさ","強":"つよ","弱":"よわ","早":"はや","速":"はや","遅":"おそ","嬉":"うれ","悲":"かな",
    "淋":"さび","寂":"さび","静":"しず","眠":"ねむ","夕":"ゆう","朝日":"あさひ","夕焼":"ゆうや",
    "一":"ひと","二":"ふた","何":"なに","誰":"だれ","何処":"どこ",
    "自分":"じぶん","気持":"きもち","気":"き","持":"も","本当":"ほんとう","大丈夫":"だいじょうぶ",
    "大切":"たいせつ","大好":"だいす","好":"す","嫌":"きら","側":"そば","傍":"そば","隣":"となり",
    "信":"しん","始":"はじ","終":"お","届":"とど","続":"つづ","探":"さが","生":"い","変":"か","抱":"だ"
  };

  function isKana(ch) { var c = ch.charCodeAt(0); return (c >= 0x3041 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff); }
  function isKanji(ch) { var c = ch.charCodeAt(0); return (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || ch === "々"; }

  /* ルビ（括弧の読み）と読み表で、行をひらがなにする */
  function toReading(line) {
    var s = "", i = 0, ch;
    while (i < line.length) {
      ch = line.charAt(i);
      if ((ch === "(" || ch === "（") && s.length) {
        var close = line.indexOf(ch === "(" ? ")" : "）", i + 1);
        if (close > i) {
          var inner = line.slice(i + 1, close), cut = s.length;
          while (cut > 0 && !isKanji(s.charAt(cut - 1)) && BREAKS.indexOf(s.charAt(cut - 1)) < 0) cut--;
          if (cut > 0 && isKanji(s.charAt(cut - 1))) { while (cut > 0 && isKanji(s.charAt(cut - 1))) cut--; }
          else cut = s.length;
          s = s.slice(0, cut) + inner; i = close + 1; continue;
        }
      }
      s += ch; i++;
    }
    var out = "", unknown = [];
    i = 0;
    while (i < s.length) {
      ch = s.charAt(i);
      if (!isKanji(ch)) { out += ch; i++; continue; }
      var hit = false;
      for (var j = Math.min(4, s.length - i); j >= 1; j--) {
        if (KANJI[s.substr(i, j)]) { out += KANJI[s.substr(i, j)]; i += j; hit = true; break; }
      }
      if (!hit) { unknown.push(ch); out += ch; i++; }
    }
    return { reading:out, unknown:unknown };
  }

  /* ひらがな1行 → 音の並び。[{text, type, wordEnd, phraseEnd, particle}] */
  function moras(reading) {
    var out = [], ch, last, word = "";
    function endWord() {
      if (!out.length || !word) { word = ""; return; }
      out[out.length - 1].wordEnd = true;
      /* 語尾の助詞は軽く歌う（短くしてよい音）として印をつける */
      for (var i = 0; i < PARTICLES.length; i++) {
        var p = PARTICLES[i];
        if (word.slice(-p.length) === p) {
          for (var k = 0; k < p.length && out.length - 1 - k >= 0; k++) out[out.length - 1 - k].particle = true;
          break;
        }
      }
      word = "";
    }
    for (var i = 0; i < reading.length; i++) {
      ch = reading.charAt(i);
      last = out.length ? out[out.length - 1] : null;
      if (BREAKS.indexOf(ch) >= 0 || /\s/.test(ch)) { endWord(); if (last && "、,。.！!？?".indexOf(ch) >= 0) last.phraseEnd = true; continue; }
      if ("「」『』【】［］()（）".indexOf(ch) >= 0) continue;
      if (LONG.indexOf(ch) >= 0) { if (last) { out.push({ text:"ー", type:"long" }); } continue; }
      if (SMALL.indexOf(ch) >= 0 && last && last.type === "normal") { last.text += ch; word += ch; continue; }
      if (ch === "゛" || ch === "゜") { if (last) last.text += ch; continue; }
      var type = SOKUON.indexOf(ch) >= 0 ? "sokuon" : NASAL.indexOf(ch) >= 0 ? "nasal" : isKana(ch) ? "normal" : "unknown";
      out.push({ text:ch, type:type });
      word += ch;
      /* 助詞のあとは言葉の切れ目とみなす（空白が無い行でも、自然な息つぎ位置を探すため） */
      if (word.length >= 2 && PARTICLES.some(function (p) { return word.slice(-p.length) === p && word.length > p.length; })) endWord();
    }
    endWord();
    if (out.length) out[out.length - 1].phraseEnd = true;
    return out;
  }

  function sectionKind(label) {
    var v = String(label || "").replace(/[\s　]/g, "").toLowerCase();
    if (/^(aメロ|a|versea|verse1|verse|1番)$/.test(v)) return "verseA";
    if (/^(bメロ|b|verseb|pre-?chorus|プレコーラス)$/.test(v)) return "verseB";
    if (/^(サビ|chorus|hook|大サビ)$/.test(v)) return "chorus";
    if (/^(cメロ|bridge|ブリッジ|間奏)$/.test(v)) return "bridge";
    return null;
  }
  function marker(line) {
    var m = String(line).trim().match(/^[\[［【]([^\]］】]+)[\]］】]$/);
    return m ? { label:m[1].trim(), kind:sectionKind(m[1]) || "verseA" } : null;
  }
  /* 指定が無いとき：前の方をAメロ、中ほどをBメロ、後ろをサビにする */
  function autoKind(i, n) {
    if (n <= 2) return "chorus";
    if (n <= 4) return i < n / 2 ? "verseA" : "chorus";
    if (i < Math.round(n * .4)) return "verseA";
    if (i < Math.round(n * .6)) return "verseB";
    return "chorus";
  }

  function parse(text) {
    var raw = String(text || "").replace(/\r\n?/g, "\n").split("\n"), lines = [], unknown = [], current = null, explicit = false;
    raw.forEach(function (l) {
      var mk = marker(l);
      if (mk) { current = mk; explicit = true; return; }
      if (!l.trim()) return;
      var r = toReading(l.trim()), ms = moras(r.reading);
      unknown = unknown.concat(r.unknown);
      if (ms.length) lines.push({ text:l.trim(), reading:r.reading, moras:ms, marked:current });
    });
    lines.forEach(function (line, i) {
      line.index = i;
      line.kind = explicit && line.marked ? line.marked.kind : autoKind(i, lines.length);
    });
    var sections = [];
    lines.forEach(function (line) {
      var s = sections[sections.length - 1];
      if (!s || s.kind !== line.kind) { s = { kind:line.kind, lines:[] }; sections.push(s); }
      line.section = sections.length - 1;
      s.lines.push(line.index);
    });
    return { lines:lines, sections:sections, explicit:explicit,
      unknown:unknown.filter(function (v, i, a) { return a.indexOf(v) === i; }) };
  }

  /* 歌詞なし（インスト・BGM）：歌詞の代わりに「フレーズの長さ」と「言葉の区切りにあたる位置」を作る。
     作曲器（compose.js）は歌詞のときと同じに扱えるので、構成・メロディ・編曲の仕組みはそのまま使える。
     対になる行は同じ長さ・同じ区切りにして、A/A' の反復が生まれるようにする。 */
  var FORMS = {
    short:[["verseA", 2], ["chorus", 2]],
    medium:[["verseA", 2], ["verseB", 2], ["chorus", 4]],
    long:[["verseA", 4], ["verseB", 2], ["chorus", 4], ["verseA", 2], ["chorus", 4]]
  };
  var RANGE = { verseA:[8, 11], verseB:[9, 12], chorus:[10, 13], bridge:[8, 11] };
  function instrumental(opts) {
    var o = opts || {}, s = (o.seed >>> 0) || 1, R = function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    var form = FORMS[o.length] || FORMS.medium, lines = [], sections = [], shapes = {};
    form.forEach(function (f) {
      var kind = f[0], sec = { kind:kind, lines:[] }, r = RANGE[kind];
      for (var i = 0; i < f[1]; i++) {
        var key = kind + ":" + (i % 2), shape;
        /* 対の2行目は1行目と同じ形（ときどき1音だけ変える）。2回目のサビは1回目と同じ形 */
        if (i % 2 === 1 && shapes[kind + ":0"] && R() < .75) shape = shapes[kind + ":0"].slice();
        else if (shapes[key] && R() < .8) shape = shapes[key].slice();
        else {
          var n = r[0] + Math.floor(R() * (r[1] - r[0] + 1)), groups = [], left = n;
          while (left > 0) { var g = Math.min(left, 2 + Math.floor(R() * 3)); groups.push(g); left -= g; }
          shape = groups;
        }
        shapes[key] = shape;
        var ms = [];
        shape.forEach(function (g, gi) {
          for (var k = 0; k < g; k++) ms.push({ text:"", type:"normal", wordEnd:k === g - 1, phraseEnd:k === g - 1 && (gi === shape.length - 1 || (shape.length > 3 && gi === 1 && R() < .5)) });
        });
        var idx = lines.length;
        lines.push({ text:"（インスト）", reading:"", moras:ms, index:idx, kind:kind, section:sections.length });
        sec.lines.push(idx);
      }
      sections.push(sec);
    });
    return { lines:lines, sections:sections, explicit:true, unknown:[], instrumental:true };
  }

  root.lyrics = { parse:parse, instrumental:instrumental, toReading:toReading, moras:moras, KANJI:KANJI };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
