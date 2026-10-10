曲・BGM を作るときの使い方は AGENTS.md を読んでください。

要点：アプリの自動作曲（テンプレート）に縛られず、自由スコア（`examples/morning-tram.score.json` の形）を自分で書き、
`node tools/render.mjs song.json --stats` で WAV／MIDI に書き出して、数値でバランスを確かめながら仕上げる。
