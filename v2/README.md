# 歌スタジオ 2

歌詞から曲の原型（構成・コード・メロディ・伴奏）を作り、物理モデル音源で演奏するブラウザアプリ。
外部ライブラリ・録音素材・外部通信なし。`index.html` を開けば動きます（AudioWorklet 対応ブラウザ）。

## しくみ（1か所に1つの役目）

| ファイル | 役目 |
|---|---|
| `js/lyrics.js` | 歌詞 → 音（モーラ）・言葉・フレーズ・セクション（`[サビ]` など） |
| `js/moods.js` | 雰囲気：テンポ・ノリ・楽器・セクションごとのコード進行 |
| `js/compose.js` | 構成（前奏→A→B→サビ→後奏→終止）・小節ごとのコード・メロディ。案A/B/C |
| `js/arrange.js` | 伴奏：楽器ごとの弾き方、セクションの強弱、フィルイン、ベースの経過音、前奏のフック |
| `js/instruments.js` | 楽器表：音源の設定・弾き方・MIDI番号・音量合わせ |
| `js/engine/` | 物理モデル音源（弦・皮・ハンマー・唇の振動計算）と再生／WAV書き出し |
| `js/export.js` / `js/musicxml.js` | MIDI・WAV・プロジェクト／歌詞つきMusicXML |
| `js/blueprint.js` | AI設計図：AIに渡す指示文と、返ってきたJSON（構成・小節ごとのコード・歌詞つきメロディ・編成・キメ）の読み込み |
| `js/app.js` | 画面 |

曲データは「セクションの並び」と「小節ごとのコード」を持ちます（進行の繰り返しに縛られない）。

## AIに自由に作曲してもらう（テンプレートなし）

`js/engine/score.js` の**自由スコア**（`examples/morning-tram.score.json`）は、トラック・音符・ドラムの1打まで直接書く形式です。
テンポ変化・拍子・パン・オリジナル音色（音源の生の設定）も書けます。
Claude Code・Codex などは `node tools/render.mjs song.json --stats` で、ブラウザなしに WAV／MIDI を書き出せます（説明は AGENTS.md）。
アプリの「AI設計図」の欄に貼っても再生できます。
`dev-test.html` は開発用の確認ページです。

## 引き継いだもの
- 物理モデル音源（このプロジェクトで作成）。音色の調整では Salamander Drumkit（CC BY-SA）・University of Iowa MIS（Steinway B）・jRhodes3d（CC BY-NC）の録音を測定値の参考にだけ使い、音声そのものは含みません。
- 歌スタジオ ZEN の `theory.js`・`musicxml.js`、漢字の読み表。