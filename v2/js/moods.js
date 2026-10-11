/* moods.js — 雰囲気。テンポ・調・ノリ・楽器・セクションごとのコード進行をまとめて決める。
   進行は度数で書く：d＝スケールの度数（0＝I）、t＝和音の種類（省略すると調に合った形）。
   "@7dom7" のように @ を付けると主音からの半音数（調の外の和音を使うとき）。 */
(function (root) {
  "use strict";
  function P(list) {
    return list.map(function (c) {
      if (typeof c === "number") return { d:c };
      var m = String(c).match(/^(@?)(\d+)(.*)$/);
      return m[1] ? { x:+m[2], t:m[3] || "maj" } : { d:+m[2], t:m[3] || undefined };
    });
  }
  var MOODS = [
    { id:"shittori", name:"しっとり", note:"ピアノのバラード", bpm:76, mode:"major", groove:"ballad",
      ins:{ melody:"piano", comp:"piano", bass:"fingerbass", kit:"soft" },
      prog:{ verseA:P([0, 4, 5, 3]), verseB:P(["1min7", "2min7", "3maj7", "4dom7"]), chorus:P(["3maj7", "4dom7", "2min7", 5]), bridge:P([5, 3, 1, 4]) },
      mel:{ step:.8, lift:5 } },
    { id:"hashiru", name:"走り出す", note:"アコギで駆け抜ける", bpm:132, mode:"major", groove:"eight",
      ins:{ melody:"synth", comp:"aguitar", bass:"pickbass", kit:"standard" },
      prog:{ verseA:P([5, 3, 4, 0]), verseB:P([3, 4, 2, 5]), chorus:P([0, 4, 5, 3]), bridge:P([1, 4, 0, 5]) },
      mel:{ step:.65, lift:5 } },
    { id:"setsunai", name:"切ない", note:"短調、エレピ", bpm:92, mode:"minor", groove:"ballad",
      ins:{ melody:"strings", comp:"rhodes", bass:"fretless", kit:"soft" },
      prog:{ verseA:P(["0min7", 5, 2, 6]), verseB:P([3, 4, 5, 6]), chorus:P([5, 6, "@7dom7", 0]), bridge:P([3, 0, 5, 4]) },
      mel:{ step:.8, lift:4 } },
    { id:"yoru", name:"夜の街", note:"シティポップ", bpm:100, mode:"major", groove:"sixteen",
      ins:{ melody:"synth", comp:"rhodes", bass:"fingerbass", kit:"tight" },
      prog:{ verseA:P(["3maj7", "2min7", "5min7", "5min7"]), verseB:P(["1min7", "4dom7", "0maj7", "5min7"]), chorus:P(["3maj7", "4dom7", "2min7", "5min7"]), bridge:P(["1min9", "4dom9", "0maj9", "0maj9"]) },
      mel:{ step:.7, lift:4 } },
    { id:"yurayura", name:"ゆらゆら", note:"ボサノバ", bpm:108, mode:"major", groove:"bossa",
      ins:{ melody:"flute", comp:"nylon", bass:"upright", kit:"brush" },
      prog:{ verseA:P(["0maj7", "1min7", "4dom7", "0maj7"]), verseB:P(["3maj7", "6m7b5", "2min7", "5min7"]), chorus:P(["1min7", "4dom7", "0maj7", "5min7"]), bridge:P(["3maj7", "3maj7", "2min7", "5dom7"]) },
      mel:{ step:.75, lift:3 } },
    { id:"atsui", name:"熱い", note:"ギターロック", bpm:144, mode:"major", groove:"rock",
      ins:{ melody:"crunch", comp:"crunch", bass:"pickbass", kit:"rock" },
      prog:{ verseA:P([0, "@10", 3, 0]), verseB:P([3, 4, 5, 4]), chorus:P([0, 4, 5, 3]), bridge:P([5, 3, 0, 4]) },
      mel:{ step:.6, lift:5 } },
    { id:"brass", name:"ブラスポップ", note:"明るく華やか", bpm:150, mode:"major", groove:"eight",
      ins:{ melody:"popbrass", comp:"popbrass", bass:"fingerbass", kit:"standard" },
      prog:{ verseA:P([0, 4, 5, 2]), verseB:P([3, 4, 2, 5]), chorus:P([3, 4, 2, 5]), bridge:P([1, 4, 0, 0]) },
      mel:{ step:.65, lift:5 } },
    { id:"electro", name:"Jエレクトロ", note:"キラキラ4つ打ち", bpm:128, mode:"major", groove:"sixteen",
      ins:{ melody:"chip", comp:"supersaw", bass:"synbass", kit:"tight" },
      prog:{ verseA:P([3, 4, 2, 5]), verseB:P([1, 2, 3, 4]), chorus:P([3, 4, 2, 5]), bridge:P([5, 3, 4, 0]) },
      mel:{ step:.6, lift:5 } },
    { id:"funk", name:"ファンク", note:"スラップで跳ねる", bpm:104, mode:"minor", groove:"funk",
      ins:{ melody:"synbrass", comp:"eguitar", bass:"slapbass", kit:"tight" },
      prog:{ verseA:P(["0min7", "0min7", "3min7", "3min7"]), verseB:P([5, 6, 4, 4]), chorus:P(["0min7", "3min7", 6, 5]), bridge:P([5, 6, 0, 0]) },
      mel:{ step:.65, lift:3 } },
    { id:"lounge", name:"夜のラウンジ", note:"レトロなトランペット", bpm:74, mode:"major", groove:"ballad",
      ins:{ melody:"trumpet", comp:"rhodes", bass:"upright", kit:"jazz" },
      prog:{ verseA:P(["0maj7", "5min7", "1min7", "4dom7"]), verseB:P(["2min7", "5dom7", "1min7", "4dom7"]), chorus:P(["3maj7", "2dom7", "5min7", "1min7"]), bridge:P(["1min7", "4dom7", "0maj7", "0maj7"]) },
      mel:{ step:.8, lift:4 } },
    { id:"nemuru", name:"ねむる", note:"オルゴール、静かに", bpm:66, mode:"major", groove:"quiet",
      ins:{ melody:"bell", comp:"piano", bass:"upright", kit:"soft" },
      prog:{ verseA:P([0, 0, 3, 0]), verseB:P([3, 0, 3, 4]), chorus:P([3, 4, 0, 5]), bridge:P([5, 3, 4, 0]) },
      mel:{ step:.85, lift:3 } }
  ];
  /* 和音の層の初期設定：1層目が土台、2層目以降がBメロやサビで重なって厚みを足す */
  var L = function (ins, style, when, vol) { return { ins:ins, style:style || "auto", when:when || "all", vol:vol === undefined ? 1 : vol }; };
  var LAYERS = {
    shittori:[L("piano"), L("strings", "pad", "chorus", .8)],
    hashiru:[L("aguitar"), L("piano", "piano", "build", .8)],
    setsunai:[L("rhodes"), L("strings", "pad", "build", .8)],
    yoru:[L("rhodes"), L("eguitar", "clean", "build", .8), L("warmpad", "pad", "chorus", .7)],
    yurayura:[L("nylon"), L("vibes", "pad", "chorus", .7)],
    atsui:[L("crunch"), L("rockorgan", "pad", "chorus", .7)],
    brass:[L("crunch"), L("popbrass", "brass", "build", 1), L("piano", "piano", "chorus", .7)],
    electro:[L("supersaw"), L("pluck", "arp", "build", .8)],
    funk:[L("eguitar"), L("rhodes", "ep", "build", .8), L("synbrass", "brass", "chorus", .9)],
    lounge:[L("rhodes"), L("strings", "pad", "chorus", .7)],
    nemuru:[L("piano"), L("musicbox", "arp", "chorus", .7)]
  };
  var GROOVES = [
    { id:"ballad", name:"バラード" }, { id:"eight", name:"8ビート" }, { id:"rock", name:"ロック" }, { id:"sixteen", name:"16ビート" },
    { id:"shuffle", name:"シャッフル" }, { id:"bossa", name:"ボサノバ" }, { id:"funk", name:"ファンク" }, { id:"march", name:"マーチ" },
    { id:"quiet", name:"しずか（ドラムなし）" }
  ];
  MOODS.forEach(function (m) { m.layers = LAYERS[m.id] || [L(m.ins.comp)]; });
  function byId(id) { return MOODS.filter(function (m) { return m.id === id; })[0] || MOODS[0]; }

  /* ---------- 編成のバリエーション ----------
     曲のタイプごとに、役割別の「候補の引き出し」を持つ。
     melody＝歌メロの楽器、base＝曲全体を支える和音、color＝Bメロから重ねる色づけ（[楽器, 弾き方]）、
     pad＝サビで広げる、bass・kit＝ノリに合うもの。ここから組み合わせて、似た編成ばかりにならないようにする。 */
  var GENRE = { shittori:"ballad", hashiru:"pop", setsunai:"ballad", yoru:"city", yurayura:"bossa", atsui:"rock",
    brass:"pop", electro:"electro", funk:"funk", lounge:"jazz", nemuru:"quiet" };
  var POOLS = {
    ballad:{ melody:["piano", "softpiano", "strings", "flugel", "trumpet", "rhodes", "vibes", "musicbox", "synth", "nylon"],
      base:["piano", "softpiano", "rhodes", "nylon", "aguitar"], color:[["strings", "pad"], ["vibes", "arp"], ["musicbox", "arp"], ["flugel", "pad"], ["rhodes", "ep"], ["pizz", "arp"]],
      pad:["strings", "warmpad", "organ"], bass:["fingerbass", "fretless", "upright"], kit:["soft", "brush", "ridekit"] },
    pop:{ melody:["popbrass", "synth", "sawlead", "brightpiano", "trumpet", "xylo", "pluck", "lead", "flugel", "squarelead"],
      base:["aguitar", "brightpiano", "eguitar", "piano", "crunch"], color:[["popbrass", "brass"], ["harmon", "brass"], ["piano", "piano"], ["eguitar", "clean"], ["xylo", "arp"], ["pluck", "arp"], ["synbrass", "brass"], ["strings", "pad"]],
      pad:["strings", "warmpad", "organ", "synth"], bass:["fingerbass", "pickbass"], kit:["standard", "power", "tight"] },
    city:{ melody:["synth", "popbrass", "sawlead", "rhodes", "mutetp", "flugel", "vibes", "jazzgtr"],
      base:["rhodes", "wurli", "eguitar", "jazzgtr", "brightpiano"], color:[["eguitar", "clean"], ["popbrass", "brass"], ["synbrass", "brass"], ["vibes", "arp"], ["rhodes", "ep"], ["harmon", "brass"]],
      pad:["warmpad", "strings", "synth"], bass:["fingerbass", "slapbass", "synbass"], kit:["tight", "standard"] },
    bossa:{ melody:["flute", "flugel", "vibes", "nylon", "mutetp", "steelpan", "rhodes"],
      base:["nylon", "aguitar", "rhodes", "jazzgtr", "piano"], color:[["vibes", "arp"], ["flugel", "pad"], ["marimba", "arp"], ["rhodes", "ep"], ["steelpan", "arp"]],
      pad:["strings", "warmpad"], bass:["upright", "fretless"], kit:["brush", "jazz", "ridekit"] },
    rock:{ melody:["crunch", "dist", "sawlead", "popbrass", "lead", "rockorgan"],
      base:["crunch", "dist", "eguitar", "aguitar"], color:[["rockorgan", "pad"], ["popbrass", "brass"], ["brightpiano", "piano"], ["eguitar", "clean"], ["synbrass", "brass"]],
      pad:["rockorgan", "strings", "organ"], bass:["pickbass", "fingerbass"], kit:["rock", "power", "standard"] },
    electro:{ melody:["chip", "squarelead", "sawlead", "pluck", "popbrass", "lead", "xylo"],
      base:["supersaw", "pluck", "synth", "brightpiano"], color:[["pluck", "arp"], ["chip", "arp"], ["popbrass", "brass"], ["synbrass", "brass"], ["xylo", "arp"], ["musicbox", "arp"]],
      pad:["warmpad", "supersaw", "strings"], bass:["synbass", "fatbass"], kit:["tight", "standard", "power"] },
    funk:{ melody:["synbrass", "popbrass", "harmon", "sawlead", "rhodesbark", "jazzgtr"],
      base:["eguitar", "rhodesbark", "jazzgtr", "wurli", "rhodes"], color:[["popbrass", "brass"], ["synbrass", "brass"], ["harmon", "brass"], ["rhodes", "ep"], ["bone", "brass"], ["rockorgan", "pad"]],
      pad:["warmpad", "organ"], bass:["slapbass", "fingerbass", "fatbass"], kit:["tight", "standard", "power"] },
    jazz:{ melody:["trumpet", "flugel", "mutetp", "harmon", "jazzgtr", "vibes", "softpiano", "bone"],
      base:["rhodes", "piano", "jazzgtr", "wurli", "softpiano"], color:[["vibes", "arp"], ["mutetp", "pad"], ["bone", "pad"], ["jazzgtr", "ep"], ["strings", "pad"]],
      pad:["strings", "warmpad"], bass:["upright", "fretless"], kit:["jazz", "brush", "ridekit"] },
    quiet:{ melody:["bell", "musicbox", "vibes", "softpiano", "flute", "nylon", "strings"],
      base:["piano", "softpiano", "nylon", "rhodes"], color:[["musicbox", "arp"], ["vibes", "arp"], ["strings", "pad"], ["marimba", "arp"]],
      pad:["strings", "warmpad"], bass:["upright", "fretless"], kit:["soft", "brush"] }
  };
  function pick(list, R, avoid) {
    var c = list.filter(function (x) { return (avoid || []).indexOf(Array.isArray(x) ? x[0] : x) < 0; });
    if (!c.length) c = list;
    return c[Math.floor(R() * c.length)];
  }
  /* 雰囲気の標準編成（案A用） */
  function defaultEnsemble(m) {
    return { melody:m.ins.melody, comp:m.layers[0].ins, bass:m.ins.bass, kit:m.ins.kit, layers:JSON.parse(JSON.stringify(m.layers)) };
  }
  /* 組み合わせ違いの編成を作る。avoidMelody に挙げた楽器は歌メロに選ばない（案ごとに違う響きにするため） */
  function variantEnsemble(m, seed, avoidMelody) {
    var s = (seed >>> 0) || 1, R = function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (var i = 0; i < 4; i++) R();
    var P = POOLS[GENRE[m.id]] || POOLS.pop, melody = pick(P.melody, R, avoidMelody || []);
    var base = pick(P.base, R, [melody]), color = pick(P.color, R, [melody, base]);
    var layers = [L(base)];
    layers.push(L(color[0], color[1], R() < .5 ? "build" : "all", color[1] === "brass" ? 1 : .8));
    if (R() < .65) layers.push(L(pick(P.pad, R, [melody, base, color[0]]), "pad", "chorus", .7));
    return { melody:melody, comp:base, bass:pick(P.bass, R), kit:pick(P.kit, R), layers:layers };
  }
  /* 和音の層を1つ足すときの候補。いま使っている楽器は避け、色づけ（Bメロから）かサビで広げる層を選ぶ */
  function extraLayer(m, seed, used) {
    var s = (seed >>> 0) || 1, R = function () { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (var i = 0; i < 4; i++) R();
    var P = POOLS[GENRE[m.id]] || POOLS.pop;
    if (R() < .6) { var c = pick(P.color, R, used); return L(c[0], c[1], R() < .5 ? "build" : "all", c[1] === "brass" ? 1 : .8); }
    return L(pick(P.pad, R, used), "pad", "chorus", .7);
  }

  root.moods = { MOODS:MOODS, GROOVES:GROOVES, byId:byId, defaultEnsemble:defaultEnsemble, variantEnsemble:variantEnsemble, extraLayer:extraLayer, GENRE:GENRE };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
