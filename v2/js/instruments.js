/* instruments.js — 楽器表。音源の設定・編曲の弾き方・MIDIの音色番号を1か所にまとめる。
   楽器を増やすときは、ここに1行足すだけでよい。
   role: melody（歌メロ・前奏のフック）/ comp（和音）/ bass
   sound.kind: keys（鍵盤・シンセ・トランペットの計算部）/ gtr（6弦）/ bass（4弦）
   trim は、同じ曲を書き出して実測したパート間の音量合わせ。 */
(function (root) {
  "use strict";

  /* ---- 弦楽器の設定（dsp-guitar.js） ---- */
  var STRINGS = {
    steel:    { mode:"acoustic", sustain:4.5, bright:.72, stiff:.3, action:1, drive:0, tm:.3, symp:.5, detune:.4, autoVib:0, pickup:.16, pos:.18, body:.8 },
    eclean:   { mode:"electric", sustain:6, bright:.82, stiff:.25, action:.85, drive:.1, tm:.2, symp:.2, detune:.3, autoVib:.3, pickup:.16, pos:.18 },
    ecrunch:  { mode:"electric", sustain:7, bright:.7, stiff:.25, action:.85, drive:.5, tm:.2, symp:.15, detune:.3, autoVib:.4, pickup:.16, pos:.18 },
    bfinger:  { mode:"electric", sustain:7, bright:.6, stiff:.45, action:1.2, drive:0, tm:.25, symp:.3, detune:.35, autoVib:0, pickup:.13, pos:.16 },
    bpick:    { mode:"electric", sustain:7, bright:.72, stiff:.45, action:1.1, drive:0, tm:.25, symp:.3, detune:.35, autoVib:0, pickup:.15, pos:.14 },
    bslap:    { mode:"electric", sustain:6, bright:.88, stiff:.5, action:.95, drive:0, tm:.3, symp:.25, detune:.35, autoVib:0, pickup:.2, pos:.16 },
    bfretless:{ mode:"electric", sustain:8, bright:.62, stiff:.4, action:.9, drive:0, tm:.25, symp:.35, detune:.4, autoVib:.25, pickup:.12, pos:.14, fretless:true },
    nylon:    { mode:"acoustic", sustain:3.5, bright:.45, stiff:.2, action:.9, drive:0, tm:.25, symp:.5, detune:.35, autoVib:0, pickup:.16, pos:.22, body:.9 },
    jazz:     { mode:"electric", sustain:5, bright:.5, stiff:.25, action:.9, drive:.05, tm:.2, symp:.2, detune:.3, autoVib:.2, pickup:.1, pos:.25 },
    dist:     { mode:"electric", sustain:8, bright:.68, stiff:.25, action:.85, drive:.9, tm:.2, symp:.15, detune:.3, autoVib:.45, pickup:.16, pos:.16 },
    bupright: { mode:"electric", sustain:4, bright:.45, stiff:.4, action:.9, drive:0, tm:.25, symp:.35, detune:.4, autoVib:.2, pickup:.12, pos:.14, fretless:true }
  };

  /* ---- 鍵盤・シンセ・トランペットの設定（dsp-keys.js） ---- */
  var SYN = { uni:1, uniDet:0, uniWidth:.5, ftype:"lp24", fm:0, fmRatio:2, pump:0, pumpSync:false, arp:false, bpm:120,
    wave1:"saw", wave2:"square", detune:7, mix:.5, sub:.2, noise:0, cutoff:900, res:.3, envAmt:.6, drive:1.4, keyTrack:.5,
    aA:.003, aD:.4, aS:.6, aR:.3, fA:.002, fD:.3, fS:.2, glide:0, mono:false, lfoRate:5, lfoPitch:0, lfoFilt:0 };
  function syn(o) { var r = { instr:"synth" }, k; for (k in SYN) r[k] = SYN[k]; for (k in o) r[k] = o[k]; r.fR = r.aR; return r; }
  var HORN = { instr:"horn", hornType:"trumpet", mute:"open", lipR:1, blow:.85, hC:3.5, hAtt:.07, breath:.35, vibD:14, vibR:5.2, retro:.4, hEns:0, hScoop:0, hMono:true };
  function horn(o) { var r = {}, k; for (k in HORN) r[k] = HORN[k]; for (k in o) r[k] = o[k]; return r; }
  var P = {
    piano:  { instr:"piano", hard:.5, inharm:1, stretch:1, unison:1, sustain:1 },
    rhodes: { instr:"ep", epType:"rhodes", hard:.45, bark:.5, epAmp:1, sustain:1, trem:4.5, tremD:.3 },
    wurli:  { instr:"ep", epType:"wurli", hard:.5, bark:.55, epAmp:1, sustain:1, trem:5.5, tremD:.15 },
    pad:    syn({ wave2:"saw", detune:14, sub:0, noise:.04, cutoff:700, res:.15, envAmt:.3, drive:1.1, keyTrack:.4, aA:.5, aD:1.2, aS:.8, aR:1.2, fA:1, fD:1.5, fS:.5, lfoRate:.3, lfoFilt:.25 }),
    strings:syn({ wave2:"saw", detune:10, sub:0, cutoff:1500, res:.1, envAmt:.25, drive:1.1, aA:.25, aD:.8, aS:.85, aR:.7, fA:.4, fD:1, fS:.7, uni:3, uniDet:12, uniWidth:.8, lfoPitch:6 }),
    lead:   syn({ detune:5, mix:.45, sub:.25, cutoff:1800, res:.45, envAmt:.4, drive:2, keyTrack:.6, aA:.004, aD:.3, aS:.85, aR:.18, fA:.003, fD:.4, fS:.4, glide:.05, mono:true, lfoRate:5.5, lfoPitch:14 }),
    softLead:syn({ wave2:"saw", detune:7, uni:3, uniDet:10, cutoff:2400, res:.2, envAmt:.25, drive:1.2, aA:.03, aD:.4, aS:.75, aR:.35, fA:.03, fD:.4, fS:.6, lfoRate:5.2, lfoPitch:8 }),
    organ:  syn({ wave1:"sine", wave2:"square", detune:0, mix:.18, sub:.35, cutoff:5000, res:0, envAmt:0, drive:1.1, keyTrack:0, aA:.008, aD:.05, aS:1, aR:.08, fA:.001, fD:.1, fS:1, lfoRate:6.5, lfoPitch:4, ftype:"lp12" }),
    bell:   syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.55, fmRatio:3.5, cutoff:12000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:1.1, aS:0, aR:.7, fA:.001, fD:.5, fS:0, ftype:"lp12" }),
    marimba:syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.35, fmRatio:4, cutoff:9000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:.38, aS:0, aR:.25, fA:.001, fD:.12, fS:0, ftype:"lp12" }),
    flute:  syn({ wave1:"sine", wave2:"tri", detune:0, mix:.25, sub:0, noise:.06, cutoff:3500, res:0, envAmt:.1, drive:1, keyTrack:0, aA:.07, aD:.2, aS:.85, aR:.2, fA:.05, fD:.3, fS:.9, mono:true, glide:.03, lfoRate:5, lfoPitch:9, ftype:"lp12" }),
    chip:   syn({ wave1:"square", wave2:"square", detune:0, mix:0, sub:0, cutoff:9000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:.25, aS:.8, aR:.06, fA:.001, fD:.2, fS:1, glide:.02, mono:true, lfoRate:6, lfoPitch:6, ftype:"lp12" }),
    chipPad:syn({ wave1:"square", wave2:"square", detune:0, mix:0, sub:0, cutoff:6000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:.2, aS:.6, aR:.05, fA:.001, fD:.2, fS:1, ftype:"lp12" }),
    ssLead: syn({ wave2:"saw", detune:0, mix:0, sub:.1, uni:7, uniDet:26, uniWidth:.8, cutoff:6500, res:.12, envAmt:.15, drive:1.2, keyTrack:.3, aA:.004, aD:.5, aS:.85, aR:.35, fA:.002, fD:.4, fS:.7, lfoRate:5.5, lfoPitch:6 }),
    ssChord:syn({ wave2:"saw", detune:0, mix:0, sub:.12, uni:7, uniDet:22, uniWidth:.9, cutoff:4200, res:.1, envAmt:.2, drive:1.1, keyTrack:.3, aA:.01, aD:.6, aS:.9, aR:.25, fA:.01, fD:.5, fS:.6 }),
    pluck:  syn({ detune:6, mix:.4, sub:.15, cutoff:500, res:.4, envAmt:.75, drive:1.6, aA:.002, aD:.45, aS:0, aR:.3, fA:.001, fD:.22, fS:0 }),
    synBrass:syn({ wave2:"saw", detune:9, mix:.5, sub:.1, noise:.02, cutoff:600, res:.2, envAmt:.65, drive:1.8, keyTrack:.6, aA:.06, aD:.5, aS:.75, aR:.25, fA:.09, fD:.45, fS:.45, lfoPitch:4 }),
    synBass:syn({ wave1:"square", wave2:"saw", detune:3, mix:.35, sub:.65, cutoff:320, res:.5, envAmt:.65, drive:2.4, keyTrack:.3, aA:.002, aD:.3, aS:.75, aR:.08, fA:.001, fD:.18, fS:.15, glide:.02, mono:true }),
    brightPiano:{ instr:"piano", hard:.85, inharm:1, stretch:1, unison:1.2, sustain:1 },
    softPiano:{ instr:"piano", hard:.22, inharm:1.3, stretch:1, unison:1.6, sustain:.8 },
    rhodesBark:{ instr:"ep", epType:"rhodes", hard:.7, bark:.85, epAmp:1.4, sustain:1, trem:5, tremD:.15 },
    rockOrgan:syn({ wave1:"sine", wave2:"square", detune:0, mix:.3, sub:.4, cutoff:4000, res:0, envAmt:0, drive:3, keyTrack:0, aA:.005, aD:.05, aS:1, aR:.06, fA:.001, fD:.1, fS:1, lfoRate:6.8, lfoPitch:6, ftype:"lp12" }),
    warmPad:syn({ wave2:"saw", detune:9, sub:.1, noise:.02, cutoff:450, res:.1, envAmt:.35, drive:1.1, keyTrack:.4, aA:.9, aD:1.5, aS:.85, aR:1.8, fA:1.6, fD:2, fS:.6, uni:3, uniDet:9, uniWidth:.9, lfoRate:.25, lfoFilt:.2 }),
    sawLead:syn({ wave2:"saw", detune:9, mix:.5, sub:.15, cutoff:3200, res:.25, envAmt:.3, drive:1.6, keyTrack:.5, aA:.006, aD:.3, aS:.9, aR:.2, fA:.004, fD:.4, fS:.6, glide:.04, mono:true, lfoRate:5.6, lfoPitch:12 }),
    squareLead:syn({ wave1:"square", wave2:"square", detune:6, mix:.4, sub:0, cutoff:2600, res:.2, envAmt:.25, drive:1.3, keyTrack:.4, aA:.005, aD:.3, aS:.85, aR:.15, fA:.004, fD:.3, fS:.6, glide:.03, mono:true, lfoRate:5.8, lfoPitch:10, ftype:"lp12" }),
    pizz:   syn({ wave2:"saw", detune:8, mix:.5, sub:0, cutoff:1400, res:.15, envAmt:.6, drive:1.1, keyTrack:.5, aA:.002, aD:.22, aS:0, aR:.15, fA:.001, fD:.12, fS:0, uni:3, uniDet:10, uniWidth:.7 }),
    vibes:  syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.22, fmRatio:4, cutoff:9000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:2.4, aS:0, aR:1.2, fA:.001, fD:.4, fS:0, lfoRate:5.5, lfoPitch:0, ftype:"lp12" }),
    musicBox:syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.4, fmRatio:5, cutoff:12000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:.9, aS:0, aR:.6, fA:.001, fD:.25, fS:0, ftype:"lp12" }),
    xylo:   syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.5, fmRatio:3, cutoff:10000, res:0, envAmt:0, drive:1, keyTrack:0, aA:.001, aD:.2, aS:0, aR:.12, fA:.001, fD:.08, fS:0, ftype:"lp12" }),
    steelPan:syn({ wave1:"sine", wave2:"sine", detune:0, mix:0, sub:0, fm:.35, fmRatio:2, cutoff:8000, res:0, envAmt:0, drive:1.2, keyTrack:0, aA:.002, aD:.9, aS:.05, aR:.5, fA:.001, fD:.3, fS:0, lfoRate:6, lfoPitch:3, ftype:"lp12" }),
    fatBass:syn({ wave1:"saw", wave2:"square", detune:8, mix:.5, sub:.9, cutoff:220, res:.35, envAmt:.5, drive:2.8, keyTrack:.2, aA:.003, aD:.35, aS:.8, aR:.08, fA:.001, fD:.25, fS:.25, glide:.03, mono:true }),
    tpSoft: horn({}),
    harmonLead:horn({ mute:"harmon", blow:1, hC:5, hAtt:.04, breath:.25, vibD:5, retro:.3 }),
    harmonSec:horn({ mute:"harmon", blow:.95, hC:4.5, hAtt:.04, breath:.2, vibD:4, retro:.25, hEns:.6, hMono:false }),
    bone:   horn({ mute:"felt", blow:.95, hC:3, hAtt:.06, breath:.3, vibD:8, vibR:4.8, retro:.2 }),
    boneSec:horn({ mute:"felt", blow:.9, hC:2.8, hAtt:.06, breath:.25, vibD:4, retro:.2, hEns:.7, hMono:false }),
    tpSec:  horn({ blow:1.1, hC:5.5, hAtt:.025, breath:.15, vibD:4, vibR:5.8, retro:.05, hEns:.85, hScoop:25, hMono:false }),
    popLead:horn({ blow:1.1, hC:5.5, hAtt:.03, breath:.2, vibD:9, vibR:5.6, retro:.05, hEns:.7, hScoop:22 }),
    flugel: horn({ hornType:"flugel", blow:.9, hC:4, hAtt:.085, breath:.42, vibD:10, vibR:5, retro:.35 }),
    flugelSec:horn({ hornType:"flugel", blow:.85, hC:3.5, hAtt:.08, breath:.3, vibD:6, retro:.3, hEns:.6, hMono:false }),
    cupLead:horn({ mute:"cup", blow:.95, hC:4.5, hAtt:.05, breath:.3, vibD:10, retro:.5 }),
    cupSec: horn({ mute:"cup", blow:.9, hC:4, hAtt:.05, breath:.25, vibD:5, retro:.4, hEns:.6, hMono:false })
  };
  function K(patch, trim, extra) { var o = { kind:"keys", p:P[patch], trim:trim }, k; for (k in extra || {}) o[k] = extra[k]; return o; }
  function G(str, trim, extra) { var o = { kind:"gtr", str:str, trim:trim }, k; for (k in extra || {}) o[k] = extra[k]; return o; }
  function B(str, trim, tech) { return { kind:"bass", str:str, trim:trim, tech:tech }; }

  /* comp: 和音パートでの弾き方（arrange.js の型の名前） */
  var LIST = [
    { id:"piano", name:"ピアノ", group:"鍵盤", program:0, comp:"piano",
      melody:K("piano", 1.46, { board:.7 }), compSound:K("piano", .79, { board:.7 }) },
    { id:"rhodes", name:"エレピ（ローズ）", group:"鍵盤", program:4, comp:"ep",
      melody:K("rhodes", .97, { chorus:.25 }), compSound:K("rhodes", .52, { chorus:.25 }) },
    { id:"wurli", name:"エレピ（ウーリッツァー）", group:"鍵盤", program:4, comp:"ep",
      melody:K("wurli", .88, { chorus:.2 }), compSound:K("wurli", .55, { chorus:.2 }) },
    { id:"brightpiano", name:"明るいピアノ", group:"鍵盤", program:1, comp:"piano",
      melody:K("brightPiano", 1.56, { board:.6 }), compSound:K("brightPiano", .88, { board:.6 }) },
    { id:"softpiano", name:"やわらかピアノ（アップライト風）", group:"鍵盤", program:0, comp:"piano",
      melody:K("softPiano", 1.59, { board:.85 }), compSound:K("softPiano", .75, { board:.85 }) },
    { id:"rhodesbark", name:"エレピ（ローズ・歪ませ）", group:"鍵盤", program:4, comp:"ep",
      melody:K("rhodesBark", .43, { chorus:.3 }), compSound:K("rhodesBark", .25, { chorus:.3 }) },
    { id:"rockorgan", name:"ロックオルガン", group:"鍵盤", program:18, comp:"pad",
      melody:K("rockOrgan", .41, { chorus:.5 }), compSound:K("rockOrgan", .11, { chorus:.5 }) },
    { id:"organ", name:"オルガン", group:"鍵盤", program:16, comp:"pad",
      melody:K("organ", .39, { chorus:.4 }), compSound:K("organ", .116, { chorus:.4 }) },
    { id:"aguitar", name:"アコースティックギター", group:"ギター", program:25, comp:"acoustic",
      melody:G("steel", .34, { mono:true }), compSound:G("steel", .16) },
    { id:"eguitar", name:"エレキギター（クリーン）", group:"ギター", program:27, comp:"clean",
      melody:G("eclean", .2, { mono:true }), compSound:G("eclean", .093) },
    { id:"crunch", name:"エレキギター（クランチ）", group:"ギター", program:29, comp:"crunch",
      melody:G("ecrunch", .06, { mono:true }), compSound:G("ecrunch", .037) },
    { id:"nylon", name:"クラシックギター（ナイロン弦風）", group:"ギター", program:24, comp:"acoustic",
      melody:G("nylon", .34, { mono:true }), compSound:G("nylon", .15) },
    { id:"jazzgtr", name:"ジャズギター", group:"ギター", program:26, comp:"ep",
      melody:G("jazz", .36, { mono:true }), compSound:G("jazz", .21) },
    { id:"dist", name:"ディストーションギター", group:"ギター", program:30, comp:"crunch",
      melody:G("dist", .064, { mono:true }), compSound:G("dist", .046) },
    { id:"trumpet", name:"トランペット（レトロ・ソフト）", group:"管楽器", program:56, comp:"brass",
      melody:K("tpSoft", .64), compSound:K("tpSec", .18) },
    { id:"popbrass", name:"ポップ・ブラス（2人）", group:"管楽器", program:61, comp:"brass",
      melody:K("popLead", .55), compSound:K("tpSec", .18) },
    { id:"flugel", name:"フリューゲルホルン", group:"管楽器", program:56, comp:"brass",
      melody:K("flugel", .8), compSound:K("flugelSec", .25) },
    { id:"mutetp", name:"ミュート・トランペット", group:"管楽器", program:59, comp:"brass",
      melody:K("cupLead", .61), compSound:K("cupSec", .22) },
    { id:"harmon", name:"ハーマンミュート・トランペット", group:"管楽器", program:59, comp:"brass",
      melody:K("harmonLead", .6), compSound:K("harmonSec", .28) },
    { id:"bone", name:"トロンボーン風（低く暗い金管）", group:"管楽器", program:57, comp:"brass",
      melody:K("bone", .83), compSound:K("boneSec", .32) },
    { id:"flute", name:"笛（やわらかシンセ）", group:"管楽器", program:73, comp:"pad",
      melody:K("flute", .44), compSound:K("pad", .31, { chorus:.5 }) },
    { id:"strings", name:"ストリングス", group:"シンセ・その他", program:48, comp:"pad",
      melody:K("strings", .83, { chorus:.3 }), compSound:K("strings", .24, { chorus:.3 }) },
    { id:"synth", name:"やわらかシンセ", group:"シンセ・その他", program:89, comp:"pad",
      melody:K("softLead", 1.06, { chorus:.25 }), compSound:K("pad", .3, { chorus:.6 }) },
    { id:"warmpad", name:"あたたかいパッド", group:"シンセ・その他", program:89, comp:"pad",
      melody:K("warmPad", 4, { chorus:.5 }), compSound:K("warmPad", .26, { chorus:.6 }) },
    { id:"pizz", name:"弦のピチカート風", group:"シンセ・その他", program:45, comp:"arp",
      melody:K("pizz", 2.88, { chorus:.3 }), compSound:K("pizz", 3, { chorus:.3 }) },
    { id:"supersaw", name:"スーパーソウ", group:"シンセ・その他", program:81, comp:"saw",
      melody:K("ssLead", .5, { chorus:.2 }), compSound:K("ssChord", .165, { chorus:.25 }) },
    { id:"lead", name:"シンセリード", group:"シンセ・その他", program:80, comp:"arp",
      melody:K("lead", .95, { chorus:.15 }), compSound:K("pluck", 2.2, { chorus:.35 }) },
    { id:"sawlead", name:"ノコギリ波リード", group:"シンセ・その他", program:81, comp:"pad",
      melody:K("sawLead", .98, { chorus:.2 }), compSound:K("pad", .31, { chorus:.4 }) },
    { id:"squarelead", name:"矩形波リード", group:"シンセ・その他", program:80, comp:"arp",
      melody:K("squareLead", .5, { chorus:.2 }), compSound:K("chipPad", .42) },
    { id:"pluck", name:"シンセプラック", group:"シンセ・その他", program:84, comp:"arp",
      melody:K("pluck", 2.95, { chorus:.35 }), compSound:K("pluck", 1.75, { chorus:.35 }) },
    { id:"synbrass", name:"シンセブラス", group:"シンセ・その他", program:62, comp:"brass",
      melody:K("synBrass", .8, { chorus:.3 }), compSound:K("synBrass", .3, { chorus:.3 }) },
    { id:"bell", name:"オルゴール（FMベル）", group:"シンセ・その他", program:10, comp:"arp",
      melody:K("bell", .69), compSound:K("bell", .49) },
    { id:"vibes", name:"ビブラフォン風", group:"シンセ・その他", program:11, comp:"arp",
      melody:K("vibes", .45, { chorus:.3 }), compSound:K("vibes", .45, { chorus:.3 }) },
    { id:"musicbox", name:"オルゴール（高め）", group:"シンセ・その他", program:10, comp:"arp",
      melody:K("musicBox", .56), compSound:K("musicBox", .6) },
    { id:"xylo", name:"木琴", group:"シンセ・その他", program:13, comp:"arp",
      melody:K("xylo", 1.2), compSound:K("xylo", 1.23) },
    { id:"steelpan", name:"スチールパン風", group:"シンセ・その他", program:114, comp:"arp",
      melody:K("steelPan", .57), compSound:K("steelPan", .62) },
    { id:"marimba", name:"マリンバ", group:"シンセ・その他", program:12, comp:"arp",
      melody:K("marimba", .86), compSound:K("marimba", .9) },
    { id:"chip", name:"8bit", group:"シンセ・その他", program:80, comp:"arp",
      melody:K("chip", .3), compSound:K("chipPad", .42) },
    /* ベース専用 */
    { id:"fingerbass", name:"エレキベース（指）", group:"ベース", program:33, bass:"normal", bassSound:B("bfinger", .42) },
    { id:"pickbass", name:"エレキベース（ピック）", group:"ベース", program:34, bass:"normal", bassSound:B("bpick", .35, "pick") },
    { id:"slapbass", name:"スラップベース", group:"ベース", program:36, bass:"slap", bassSound:B("bslap", .51, "slap") },
    { id:"fretless", name:"フレットレスベース", group:"ベース", program:35, bass:"normal", bassSound:B("bfretless", .67) },
    { id:"upright", name:"ウッドベース", group:"ベース", program:32, bass:"upright", bassSound:B("bupright", .79) },
    { id:"synbass", name:"シンセベース", group:"ベース", program:38, bass:"synth", bassSound:K("synBass", .65) },
    { id:"fatbass", name:"シンセベース（太い）", group:"ベース", program:39, bass:"synth", bassSound:K("fatBass", .5) }
  ];
  var BY = {};
  LIST.forEach(function (it) { BY[it.id] = it; });

  /* ドラムキット：同じ楽譜でも、叩く場所と強さを変える */
  var KITS = [
    { id:"standard", name:"スタンダード" },
    { id:"rock", name:"ロック（オープンハット）", map:{ hat:{ p:"hat", art:"open", pos:.7 } }, vel:{ kick:1.05, snare:1.05, hat:.8 } },
    { id:"tight", name:"タイト", map:{ hat:{ p:"hat", art:"closed", pos:.75 } }, vel:{ hat:.9 } },
    { id:"jazz", name:"ジャズ（ライド＋スティック）", map:{ snare:{ p:"snare", art:"side" }, hat:{ p:"ride", art:"bow", pos:.62 } }, vel:{ kick:.7, hat:.8 } },
    { id:"brush", name:"ブラシ風（やさしく）", map:{ snare:{ p:"snare", art:"side" }, hat:{ p:"hat", art:"pedal" } }, vel:{ kick:.6, snare:.7, hat:.7, crash:.55, tomH:.7, tomM:.7, tomL:.7 } },
    { id:"power", name:"パワー（強く叩く）", vel:{ kick:1.15, snare:1.15, hat:.9, crash:1.1, tomH:1.1, tomM:1.1, tomL:1.1 } },
    { id:"ridekit", name:"ライド中心", map:{ hat:{ p:"ride", art:"bow", pos:.62 }, open:{ p:"ride", art:"bell", pos:.1 } } },
    { id:"soft", name:"ソフト", map:{ snare:{ p:"snare", art:"side" }, hat:{ p:"ride", art:"bow", pos:.62 } }, vel:{ kick:.75, snare:.85, hat:.6, crash:.7 } }
  ];

  function byId(id) { return BY[id] || BY.piano; }
  function forRole(role) {
    return LIST.filter(function (it) { return role === "bass" ? !!it.bass || !!it.bassSound : !!it[role === "comp" ? "compSound" : "melody"]; });
  }
  function kit(id) { return KITS.filter(function (k) { return k.id === id; })[0] || KITS[0]; }

  root.instruments = { LIST:LIST, KITS:KITS, STRINGS:STRINGS, byId:byId, forRole:forRole, kit:kit };
})(typeof window !== "undefined" ? (window.US = window.US || {}) : (module.exports = {}));
