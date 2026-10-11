#!/usr/bin/env node
/* tools/render.mjs — 歌スタジオ 2 の物理モデル音源で、ターミナルから曲を書き出す（ブラウザ不要）。
   AI（Claude Code・Codex など）が「書く → 書き出す → 数値で確かめる → 直す」を自分で回せるようにするための道具。

   使い方:
     node tools/render.mjs song.json                 → song.wav と song.mid を作る
     node tools/render.mjs song.json -o out.wav      → 書き出し先を指定
     node tools/render.mjs song.json --check         → 書式だけ確かめる（速い）
     node tools/render.mjs song.json --stats         → トラックごとの音量（RMS・ピーク）も表示
     node tools/render.mjs song.json --from 32 --to 64   → 一部分だけ（拍）
     node tools/render.mjs --list                    → 使える楽器・ドラム・キット・弾き方の一覧
   入力は自由スコア（format: "uta-studio-2/score"）か、AI設計図（format: "uta-studio-2/blueprint"）。
   書式は AGENTS.md を参照。 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = { US: {} };
const FILES = ["js/theory.js", "js/instruments.js", "js/moods.js", "js/lyrics.js", "js/compose.js", "js/arrange.js", "js/musicxml.js",
  "js/export.js", "js/blueprint.js", "js/engine/dsp-guitar.js", "js/engine/dsp-drum.js", "js/engine/dsp-keys.js",
  "js/engine/core.js", "js/engine/score.js", "js/engine/player.js", "js/engine/mixer.js"];
for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(APP, f), "utf8"), { filename: f });
const US = globalThis.window.US;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : def; };
const say = (...m) => { if (!flag("--quiet")) console.error(...m); };

if (flag("--list") || !args.length || flag("-h") || flag("--help")) {
  if (!flag("--list")) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).join("\n")); process.exit(args.length ? 0 : 1); }
  const I = US.instruments;
  console.log("# 楽器（instrument）: id — 名前 — 使える sound");
  for (const it of I.LIST) console.log(`${it.id}\t${it.name}\t${["melody", "comp", "bass"].filter((r) => (r === "comp" ? it.compSound : r === "bass" ? it.bassSound : it.melody)).join(",")}`);
  console.log("\n# ドラムキット（kit）\n" + I.KITS.map((k) => `${k.id}\t${k.name}`).join("\n"));
  console.log("\n# ドラムの名前（kind）。GM の音番号（36 など）でも可\n" + Object.keys(US.core.DRUMMAP).join(", "));
  console.log("\n# 弦楽器の生の設定（engine.str）\n" + Object.keys(I.STRINGS).join(", "));
  console.log("\n# AI設計図用：groove / layers.style / layers.when\n" + US.moods.GROOVES.map((g) => g.id).join(", ") + "\n" + US.arrange.STYLES.map((s) => s[0]).join(", ") + "\n" + US.arrange.WHEN.map((w) => w[0]).join(", "));
  process.exit(0);
}

const input = args.find((a, i) => !a.startsWith("-") && !["-o", "--mid", "--from", "--to", "--sr"].includes(args[i - 1]));
if (!input) { console.error("入力の JSON ファイルを指定してください"); process.exit(1); }
let raw;
try { raw = JSON.parse(fs.readFileSync(input, "utf8")); } catch (e) { console.error("JSON として読めません: " + e.message); process.exit(1); }

/* 自由スコアか設計図かで、パートの作り方を分ける */
let parts, seconds, master, midiBytes, summary, tempoSec = null;
const sr = Math.max(8000, Math.min(96000, +opt("--sr", 44100)));
try {
  if (raw.format === US.score.FORMAT) {
    const sc = US.score.read(raw);
    const from = +opt("--from", 0), to = opt("--to") === undefined ? sc.lengthBeats : +opt("--to");
    parts = US.score.parts(sc, { fromBeat: from });
    parts.forEach((p) => { p.events = p.events.filter((e) => e.t <= sc.tempo.sec(to) - sc.tempo.sec(from)); });
    seconds = sc.tempo.sec(to) - sc.tempo.sec(from) + 3;
    master = sc.master; midiBytes = US.exporter.scoreMidi(sc); tempoSec = sc.tempo.sec;
    summary = `${sc.title}：${sc.tracks.length}トラック・${sc.lengthBeats}拍・${sc.seconds.toFixed(1)}秒（${sc.bpm} BPM〜）`;
  } else if (raw.format === US.blueprint.FORMAT) {
    const r = US.blueprint.read(JSON.stringify(raw)), s = r.song;
    US.arrange.arrange(s, { seed: 7 });
    parts = US.player.buildParts(s);
    seconds = s.totalSteps * 60 / s.bpm / 4 + 3; master = { volume: .75, reverb: .16 }; midiBytes = US.exporter.midi(s);
    summary = `${s.title}：設計図・${s.bars}小節・${(s.totalSteps * 15 / s.bpm).toFixed(1)}秒` + (r.warnings.length ? "（" + r.warnings.join(" ") + "）" : "");
  } else throw new Error('format は "uta-studio-2/score" か "uta-studio-2/blueprint" にしてください');
} catch (e) { console.error("書式エラー: " + e.message); process.exit(1); }

say(summary);
if (flag("--check")) { console.log("OK " + summary + "（パート " + parts.length + "）"); process.exit(0); }

const level = (L, R) => { let e = 0, p = 0; for (let i = 0; i < L.length; i++) { e += L[i] * L[i] + R[i] * R[i]; p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); } return { rms: 10 * Math.log10(e / (2 * L.length) + 1e-12), peak: p }; };
if (flag("--stats")) {
  say("トラックごとの音量（ほかを消して1本ずつ計算）:");
  for (const p of parts) {
    const r = US.mixer.render([p], { sampleRate: 22050, seconds, master });
    const l = level(r.L, r.R);
    console.log(`  ${(p.name || p.part).padEnd(16)} RMS ${l.rms.toFixed(1)} dB  ピーク ${l.peak.toFixed(2)}`);
  }
}
const t0 = Date.now();
const out = US.mixer.render(parts, { sampleRate: sr, seconds, master, onProgress: (x) => { if (!flag("--quiet")) process.stderr.write(`\r計算中 ${Math.round(x * 100)}%`); } });
if (!flag("--quiet")) process.stderr.write("\n");
const all = level(out.L, out.R);
let bad = 0; for (let i = 0; i < out.L.length; i += 7) if (!Number.isFinite(out.L[i])) bad++;
const base = input.replace(/\.json$/i, "");
const wavPath = opt("-o", base + ".wav"), midPath = opt("--mid", base + ".mid");
fs.writeFileSync(wavPath, US.exporter.wavFromChannels(out.L, out.R, sr));
if (!flag("--no-midi")) fs.writeFileSync(midPath, midiBytes);
console.log(`書き出し: ${wavPath}${flag("--no-midi") ? "" : " / " + midPath}  長さ ${seconds.toFixed(1)}秒  全体 RMS ${all.rms.toFixed(1)} dB  ピーク ${all.peak.toFixed(2)}${all.peak > 1 ? "（WAV は自動で0.98に収めました）" : ""}${bad ? "  ※異常値あり" : ""}  計算 ${((Date.now() - t0) / 1000).toFixed(1)}秒`);
