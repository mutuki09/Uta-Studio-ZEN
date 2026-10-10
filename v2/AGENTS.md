# 歌スタジオ 2 — AI（Claude Code・Codex など）向けの説明

このリポジトリは、**録音素材を使わない物理モデル音源**（弦・皮・ハンマー・唇の振動を計算する楽器）を持つ作曲ツールです。
BGM や曲を頼まれたら、**アプリの自動作曲（テンプレート）を使う必要はありません。**
下の「自由スコア」を自分で書き、`tools/render.mjs` で音にして、数値で確かめながら仕上げてください。
構成・和声・リズム・編成・音色・テンポ変化・拍子は、すべてあなたが決めて構いません。

## 進め方

1. 依頼を読み、曲の設計を決める（長さ、テンポ、調、構成、編成、聴かせどころ）
2. `examples/morning-tram.score.json` を参考に、自由スコア（JSON）を書く
3. 書式を確かめる：`node tools/render.mjs song.json --check`
4. 書き出す：`node tools/render.mjs song.json --stats` → `song.wav` と `song.mid` ができる
5. `--stats` の数字を見てバランスを直す（下の目安）。耳では確認できないので、数値と楽譜の両方で確かめる
6. 一部だけ直して聴くとき：`--from 32 --to 64`（拍）

楽器の一覧は `node tools/render.mjs --list`。Node.js 18 以上で動きます（外部パッケージ不要）。
ブラウザで聴く場合は `index.html` を開き、「AI設計図」の欄にスコアを貼って「この設計図で開く」。

## 自由スコアの書式（`format: "uta-studio-2/score"`）

```json
{
  "format": "uta-studio-2/score", "version": 1, "title": "曲名",
  "bpm": 120,
  "tempo": [{ "at": 0, "bpm": 120 }, { "at": 64, "bpm": 96 }],
  "timeSignature": [4, 4],
  "sections": [{ "name": "Intro", "at": 0 }, { "name": "Verse", "at": 16 }],
  "master": { "volume": 0.75, "reverb": 0.16 },
  "tracks": [
    { "name": "Lead", "instrument": "popbrass", "lead": true, "pan": -0.1, "volume": 1,
      "notes": [ { "t": 0, "d": 1, "n": "E4", "v": 0.8, "lyric": "き" } ] },
    { "name": "Chords", "instrument": "aguitar", "sound": "comp",
      "notes": [ { "t": 0, "d": 2, "chord": "Cmaj7", "octave": 3, "dir": -1 },
                 { "t": 2, "d": 2, "chord": ["A2", "E3", "A3", "C4"] } ] },
    { "name": "Synth", "engine": { "kind": "keys", "p": { "instr": "synth", "wave1": "saw", "cutoff": 1500 }, "trim": 0.5 },
      "notes": [ { "t": 4, "d": 0.5, "n": 72 } ] },
    { "name": "Drums", "drums": true, "kit": "standard",
      "hits": [ { "t": 0, "kind": "kick", "v": 0.95 }, { "t": 1, "kind": "snare" }, { "t": 1.5, "kind": 42 } ] }
  ]
}
```

- **時間はすべて拍**（4分音符＝1）。`t` は曲頭からの拍、`d` は長さ。小数で自由に置ける（3連＝0.333、スウィングの裏＝0.66 など）。
- `bpm` は一定のテンポ。`tempo` を書くと、その拍からテンポが変わる（リタルダンドは段階的に下げる）。
- `n`：`"C4"`（ド＝C4＝60）・`"F#3"`・`"Bb5"`、または MIDI 番号。
- `chord`：音の配列、または `"Cmaj7"`・`"Am7"`・`"G/B"` などの記号（`octave` の高さから積む。既定3）。
  使える記号：C, Cm, C7, Cmaj7, Cm7, Cdim, Cdim7, Caug, Csus4, Csus2, C6, Cm6, C9, Cm9, Cmaj9, Cadd9, C7sus4, Cm7b5, C5, 7b9, 7#9, 6/9, 分数コード。
- `v`：強さ（0〜1、または 1〜127）。強弱で音色も変わる（強く弾くと明るく）。
- `dir: -1`：ギターのアップストローク（高い弦から）。`strum`：和音を鳴らす間隔（秒）。
- `tech`（弦楽器）：`pick` / `finger` / `slap` / `pop` / `palm`（ミュート）/ `harm`（ハーモニクス）。
- `lyric`：歌詞（ひらがな1モーラ）。書いておくと MIDI に入り、アプリから MusicXML（歌声合成用）にできる。
- `lead: true`：アプリの画面で旋律として表示するトラック。
- `pan`：-1（左）〜 1（右）。`volume`：トラックの音量（0〜2）。

### 細かい演奏表現（弦・ペダル・うねり・シンバルを止める）

- **弦とフレットを指定**（ギター・ベース）：`{"t": 0, "string": 3, "fret": 14, "tech": "pick", "v": 0.9}`
  `string` は 0＝いちばん低い弦（ギター E A D G B E、ベース E A D G）。`d` を省くと鳴らしっぱなし（止めるのは `damp`）。
  `tech`：`pick` `finger` `palm`（ブリッジミュート）`harm`（ハーモニクス）`slap` `pop` `ghost`（弦を押さえきらない「チャッ」）。
- **events**（トラックに付ける、音源へそのまま渡す操作。`t` は拍）
  - ギター／ベース：
    `{"t": 1, "kind": "bend", "s": 3, "semis": 2, "time": 0.14}` チョーキング（`semis: 0` で戻す）
    `{"t": 1, "kind": "vib", "s": 3, "depth": 18, "rate": 5.6}` 指ビブラート（`depth: 0` で止める）
    `{"t": 1, "kind": "legato", "s": 4, "fret": 15, "type": "hammer" | "pull" | "slide", "vel": 0.8, "time": 0.1}` ハンマリング・プリング・スライド
    `{"t": 1, "kind": "damp", "s": 2, "dur": 0.06}` 弦を止める（ミュート・カッティングの切れ）
  - 鍵盤：`{"t": 0, "kind": "pedal", "v": 1}`（サステインペダル。0で離す）、`{"t": 0, "kind": "duck"}`（サイドチェインのうねり。`patch` の `pump` と組み合わせる）
- **ドラム**：`{"t": 1, "p": "snare", "art": "rim", "pos": 0.3, "v": 0.9}` のように `p`（kick snare hat ride crash tomH tomM floor）を書くと、キットの置き換えをせずにそのまま叩く。
  `art`：snare＝`rim` `side`、hat＝`closed` `open` `pedal`、ride＝`bow` `bell`。`pos`：叩く位置（0＝中心）。`{"t": 2, "kind": "choke", "p": "crash"}` でシンバルを手で止める。
- `gate`（トラック）：書いた長さの何割で音を切るか（既定 0.96。1 にすると書いた長さどおり。レガートは次の音と少し重ねる）。
- `engine.set`（弦楽器）：弦の設定の上書き（`drive` 歪み、`bright`、`sustain`、`body` など）。

### 手本

- `examples/morning-tram.score.json`：自由スコアの基本（和音記号・スウィング・テンポ変化・オリジナル音色）
- `examples/rosewood/*.score.json`：Claude が手で書いた9曲（Starlight Parade・Highway Rock ほか）。弦とフレット、チョーキング、カッティング、スラップ、ペダル、サイドチェインなど、細かい表現の書き方の見本。
  これらは元の作りどおり、ギター・ベースを大きめに鳴らしてマスターのコンプで整える音量設計になっている（`--stats` の目安より大きく出る）。

### 楽器の決め方（3通り）

1. `instrument`：楽器表の ID（`--list`）。`sound` で使い方を選ぶ：`melody`（旋律向き・単音のものあり）/ `comp`（和音向き）/ `bass`。
2. `instrument` ＋ `patch`：鍵盤系の設定を一部だけ上書き（例：`{"retro": 0.8}` でトランペットを古い録音風に）。
3. `engine`：音源の設定を直接書く（オリジナルの音色）。
   - `{"kind": "keys", "p": {...}, "trim": 0.5, "chorus": 0.3, "board": 0.7}`
   - `{"kind": "gtr" | "bass", "str": "steel" | "nylon" | "eclean" | "ecrunch" | "dist" | "jazz" | "bfinger" | "bpick" | "bslap" | "bfretless" | "bupright", "mono": true, "tech": "pick"}`

`keys` の `p.instr` ごとの主な設定：
- `piano`：`hard`（ハンマーの硬さ 0〜1）, `inharm`, `stretch`, `unison`, `sustain`
- `ep`：`epType`（`rhodes` / `wurli`）, `hard`, `bark`（歪み）, `epAmp`, `sustain`, `trem`, `tremD`
- `synth`：`wave1`/`wave2`（`saw` `square` `tri` `sine`）, `detune`, `mix`, `sub`, `noise`, `cutoff`, `res`, `envAmt`, `drive`, `keyTrack`,
  `aA` `aD` `aS` `aR`（音量の包絡・秒）, `fA` `fD` `fS` `fR`（フィルターの包絡）, `glide`, `mono`, `lfoRate`, `lfoPitch`（ビブラート・セント）, `lfoFilt`,
  `uni`（ユニゾン枚数 1〜9）, `uniDet`, `uniWidth`, `ftype`（`lp24` `lp12` `hp12` `bp12`）, `fm`, `fmRatio`
- `horn`（唇と管の物理モデル）：`hornType`（`trumpet` / `flugel`）, `mute`（`open` `cup` `harmon` `felt`）, `blow`（息の強さ）, `hC`（強く吹いた時の輝き）,
  `hAtt`（立ち上がり秒）, `breath`, `vibD`（ビブラートの深さ・セント）, `vibR`, `retro`（古い録音風 0〜1）, `hEns`（2人で吹く厚み 0〜1）, `hScoop`（しゃくり・セント）, `hMono`

### ドラム

`drums: true` のトラックに `hits`。`kind` は `kick` `snare` `rim` `side` `hat` `open` `pedal` `ride` `bell` `crash` `tomH` `tomM` `tomL`、
または GM の音番号（36＝キック、38＝スネア、42＝クローズハット…）。`kit`：`standard` `rock` `tight` `jazz` `brush` `power` `ridekit` `soft`。

## 音量の目安（`--stats` の RMS）

全体で RMS −14〜−17 dB・ピーク 1.0 未満が目安。トラック単体でおおよそ：
旋律 −19〜−21 dB、和音（1本）−23〜−27 dB、ベース −20〜−23 dB、ドラム −21〜−24 dB。
和音を何本も重ねるときは1本ずつ下げる。合わないときは `volume` で直す。

## 音域と鳴り方のめやす

- 6弦ギター：E2〜E6（和音は6音まで。押さえられない音は自動で外れる）。単音で弾くなら `mono: true`（melody の sound は単音）。
- ベース：E1〜G3。トランペット系：E3〜C6 がよく鳴る。歌メロ：C4〜F5 が歌いやすい。
- 単音の楽器（トランペット・リード系）は、次の音と少し重ねるとレガート（つながる）になる。
- 1曲あたりのトラックは 6〜8 本くらいまでが軽い（すべて実時間で計算するため）。

## このリポジトリの中身

- `js/engine/score.js`：自由スコアの読み込み → `js/engine/core.js`：音符→音源のイベント → `js/engine/mixer.js`：書き出し（Node 用）/ `js/engine/player.js`：ブラウザ再生
- `js/engine/dsp-*.js`：物理モデル音源（ギター・ドラム・鍵盤／シンセ／トランペット）
- `js/compose.js`・`js/arrange.js`：アプリの自動作曲・自動編曲（テンプレートあり。自由に作るときは使わない）
- `js/blueprint.js`：AI設計図（テンプレート寄りの簡易形式。歌詞から手早く作るとき用）
- `js/instruments.js`：楽器表（ID・音色・音量の合わせ値）
