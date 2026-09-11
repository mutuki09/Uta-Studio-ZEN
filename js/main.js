/* main.js — 作曲画面と純粋な計算モジュールをつなぐ。 */
(function (UG) {
  "use strict";

  var theory = UG.theory, mora = UG.mora, lyricsAnalyzer = UG.lyricsAnalyzer,
      compose = UG.compose, performancePass = UG.performancePass, songSketch = UG.songSketch, smf = UG.smf, musicxml = UG.musicxml,
      audio = UG.audio, presets = UG.presets, styles = UG.styles, arrangementTemplate = UG.arrangementTemplate,
      editor = UG.editor, blueprint = UG.blueprint, projectFile = UG.project, midiDoctor = UG.midiDoctor;
  var $ = function (id) { return document.getElementById(id); };

  var mood = presets.MOODS[0];
  var style = styles.byId("jpop-rock");
  var recipe = defaultRecipe();
  var song = null;
  var candidates = [];
  var activeCandidateIndex = 0;
  var bpm = mood.bpm;
  var seed = 20260810;
  var override = {};
  var customDrum = null;
  var partMix = partsFromEnsemble(mood.ensemble);
  var arrangementTemplateId = "free";
  var stage = null;
  var toastTimer = null;
  var lyricsAnalysis = null;
  var meterExpanded = false;
  var localSoundFont = null;
  var productEdition = String(window.UTA_GENKO_EDITION || "standard");
  var MIN_BPM = 60, DEFAULT_BPM = 80, MAX_BPM = 110;
  var importedMidiMode = false;

  function safeBpm(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = DEFAULT_BPM;
    return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(number / 2) * 2));
  }

  function importedBpm(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = DEFAULT_BPM;
    return Math.max(30, Math.min(300, Math.round(number)));
  }

  function setImportedMidiMode(enabled) {
    importedMidiMode = !!enabled;
    if ($("bpmSel")) {
      $("bpmSel").min = importedMidiMode ? 30 : MIN_BPM;
      $("bpmSel").max = importedMidiMode ? 300 : MAX_BPM;
    }
  }

  function defaultRecipe() {
    return {
      key: { root: 0, mode: "major" }, chords: [], noteLen: 2,
      density: 0.55, stepwise: 0.72, lo: 60, hi: 74, bars: 4
    };
  }

  function partsFromEnsemble(id) {
    var ensemble = presets.byId(presets.ENSEMBLES, id);
    return {
      ensembleId: ensemble.id,
      melody: { enabled: true, instrument: ensemble.melody },
      chord: { enabled: true, instrument: ensemble.chord },
      bass: { enabled: true, instrument: ensemble.bass },
      drum: { enabled: true, kit: ensemble.drum }
    };
  }

  function normalizePartMix(value) {
    var fallback = partsFromEnsemble(mood.ensemble);
    function exists(list, id) { return list.some(function (item) { return item.id === id; }); }
    if (!value || typeof value !== "object") return fallback;
    ["melody", "chord", "bass"].forEach(function (part) {
      if (!value[part] || !exists(presets.TIMBRES, value[part].instrument)) value[part] = fallback[part];
      else value[part].enabled = value[part].enabled !== false;
    });
    if (!value.drum) value.drum = fallback.drum;
    value.drum.enabled = value.drum.enabled !== false;
    value.drum.kit = exists(presets.DRUM_KITS, value.drum.kit) ? value.drum.kit : fallback.drum.kit;
    value.ensembleId = value.ensembleId || "custom";
    return value;
  }

  function showToast(message) {
    var el = $("toast");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  function current(kind) {
    return override[kind] !== undefined ? override[kind] : styles.value(style, kind, mood);
  }

  function activeMood() {
    var result = {}, name;
    for (name in mood) if (Object.prototype.hasOwnProperty.call(mood, name)) result[name] = mood[name];
    if (override.contour && override.contour !== "auto") result.contour = override.contour;
    /* 歌唱時間の下限は実際のBPMで計算する。 */
    result.bpm = safeBpm(override.bpm !== undefined ? override.bpm : result.bpm);
    return result;
  }

  function updateRecipeFromControls() {
    recipe.key = { root: +$("keySel").value, mode: $("modeSel").value };
    var range = $("rangeSel").value;
    if (range === "low") { recipe.lo = 52; recipe.hi = 67; }
    else if (range === "high") { recipe.lo = 65; recipe.hi = 81; }
    else { recipe.lo = 59; recipe.hi = 75; }
    var motion = $("motionSel").value;
    recipe.stepwise = motion === "leapy" ? 0.25 : 0.78;
  }

  function buildMoodButtons() {
    var box = $("moods");
    box.innerHTML = "";
    presets.MOODS.forEach(function (item) {
      var button = document.createElement("button");
      button.className = "mood";
      button.type = "button";
      button.setAttribute("aria-pressed", item.id === mood.id ? "true" : "false");
      var strong = document.createElement("strong");
      strong.textContent = item.name;
      var small = document.createElement("small");
      small.textContent = item.note;
      button.appendChild(strong); button.appendChild(small);
      button.addEventListener("click", function () {
        mood = item;
        arrangementTemplateId = "free";
        override = {};
        customDrum = null;
        partMix = partsFromEnsemble(mood.ensemble);
        updateMoodButtons();
        syncControls();
        showDetail();
        showToast("雰囲気を「" + item.name + "」にしました。生成ボタンで3案に反映します");
      });
      box.appendChild(button);
    });
  }

  function updateMoodButtons() {
    Array.prototype.forEach.call($("moods").children, function (button, index) {
      button.setAttribute("aria-pressed", presets.MOODS[index].id === mood.id ? "true" : "false");
    });
  }

  function buildStyleButtons() {
    var box = $("styles");
    box.innerHTML = "";
    styles.STYLES.forEach(function (item) {
      var button = document.createElement("button");
      button.className = "style-option";
      button.type = "button";
      button.setAttribute("aria-pressed", item.id === style.id ? "true" : "false");
      var strong = document.createElement("strong");
      strong.textContent = item.name;
      var small = document.createElement("small");
      small.textContent = item.note;
      button.appendChild(strong); button.appendChild(small);
      button.addEventListener("click", function () {
        style = item;
        delete override.progression;
        delete override.rhythm;
        customDrum = null;
        arrangementTemplateId = "free";
        updateStyleButtons();
        syncControls();
        showDetail();
        showToast("曲調を「" + item.name + "」にしました。生成ボタンで3案に反映します。");
      });
      box.appendChild(button);
    });
  }

  function updateStyleButtons() {
    Array.prototype.forEach.call($("styles").children, function (button, index) {
      button.setAttribute("aria-pressed", styles.STYLES[index].id === style.id ? "true" : "false");
    });
  }

  function fillSelects() {
    arrangementTemplate.TEMPLATES.forEach(function (template) {
      var option = document.createElement("option");
      option.value = template.id; option.textContent = template.name;
      $("arrangementTemplateSel").appendChild(option);
    });
    theory.NAMES.forEach(function (name, root) {
      var option = document.createElement("option");
      option.value = root; option.textContent = name;
      $("keySel").appendChild(option);
    });

    var groups = {};
    presets.PROGRESSIONS.forEach(function (progression) {
      (groups[progression.tag] = groups[progression.tag] || []).push(progression);
    });
    Object.keys(groups).forEach(function (tag) {
      var group = document.createElement("optgroup");
      group.label = tag;
      groups[tag].forEach(function (progression) {
        var option = document.createElement("option");
        option.value = progression.id;
        option.textContent = progression.name + " — " + progression.note;
        group.appendChild(option);
      });
      $("progSel").appendChild(group);
    });

    [["rhythmSel", presets.RHYTHMS]].forEach(function (entry) {
      entry[1].forEach(function (item) {
        var option = document.createElement("option");
        option.value = item.id; option.textContent = item.name;
        $(entry[0]).appendChild(option);
      });
    });

    presets.ENSEMBLES.forEach(function (ensemble) {
      var option = document.createElement("option");
      option.value = ensemble.id; option.textContent = ensemble.name;
      $("ensembleSel").appendChild(option);
    });
    var custom = document.createElement("option");
    custom.value = "custom"; custom.textContent = "カスタム編成"; custom.disabled = true;
    $("ensembleSel").appendChild(custom);

    ["melodyInstrument", "chordInstrument", "bassInstrument"].forEach(function (id) {
      presets.TIMBRES.forEach(function (instrument) {
        var option = document.createElement("option");
        option.value = instrument.id; option.textContent = instrument.name;
        $(id).appendChild(option);
      });
    });
    presets.DRUM_KITS.forEach(function (kit) {
      var option = document.createElement("option");
      option.value = kit.id; option.textContent = kit.name;
      $("drumKit").appendChild(option);
    });
  }

  function syncControls() {
    var template = arrangementTemplate.byId(arrangementTemplateId);
    $("arrangementTemplateSel").value = template.id;
    $("arrangementTemplateNote").textContent = template.note;
    $("arrangementLayerNote").hidden = template.id === "free";
    $("arrangementLayerNote").textContent = template.id === "free" ? "" :
      "追加レイヤー：アコースティックギター＋エレキギター（再生とMIDIへ自動反映）";
    $("keySel").value = recipe.key.root;
    $("modeSel").value = recipe.key.mode;
    $("progSel").value = current("progression");
    $("rhythmSel").value = current("rhythm");
    $("motionSel").value = override.contour || "auto";
    $("rangeSel").value = override.range || "middle";
    $("bpmSel").value = bpm;
    $("bpmVal").textContent = bpm + " BPM";
    syncPartControls();
  }

  function syncPartControls() {
    $("ensembleSel").value = partMix.ensembleId;
    ["melody", "chord", "bass"].forEach(function (part) {
      $(part + "Enabled").checked = partMix[part].enabled;
      $(part + "Instrument").value = partMix[part].instrument;
    });
    $("drumEnabled").checked = partMix.drum.enabled;
    $("drumKit").value = partMix.drum.kit;
  }

  function markCustomEnsemble() {
    partMix.ensembleId = "custom";
    $("ensembleSel").value = "custom";
    showDetail();
  }

  function soundSet() {
    var melodyInstrument = presets.byId(presets.TIMBRES, partMix.melody.instrument);
    var chordInstrument = presets.byId(presets.TIMBRES, partMix.chord.instrument);
    var bassInstrument = presets.byId(presets.TIMBRES, partMix.bass.instrument);
    var extraTimbres = {};
    (song && song.extraTracks || []).forEach(function (track) {
      extraTimbres[track.id] = presets.byId(presets.TIMBRES, track.timbreId).pad;
    });
    return {
      melody: melodyInstrument.melody,
      pad: chordInstrument.pad,
      bass: bassInstrument.bass,
      drumKit: partMix.drum.kit,
      extraTracks: extraTimbres,
      leadSteps: audio.hasVocal() ? +$("vocalLeadSel").value : 0,
      enabled: {
        melody: partMix.melody.enabled && !audio.hasVocal(),
        pad: partMix.chord.enabled,
        bass: partMix.bass.enabled,
        drum: partMix.drum.enabled
      },
      midi: midiSettings()
    };
  }

  function syncVocalUI() {
    var info = audio.vocalInfo();
    $("vocalStatus").textContent = info
      ? info.name + "（" + Math.round(info.duration * 10) / 10 + "秒）"
      : "歌声はまだありません";
    $("removeVocalBtn").disabled = !info;
  }

  /* 読み込んだMIDIの健康診断。外部のAIが作ったメロディは、調を外していたり
     音符が重なっていたりする。歌わせる前にここで気づけるようにする。 */
  function renderCheckup() {
    var box = $("midiCheckup"), body = $("midiCheckupBody"), button = $("midiRepairBtn");
    if (!box || !body || !button) return;
    if (!song || !song.importedMidi || !midiDoctor) { box.hidden = true; return; }
    var report = midiDoctor.diagnose(song, bpm);
    if (!report.notes) { box.hidden = true; return; }
    box.hidden = false;

    var head = '<strong class="checkup-head">歌パートの診断 — ' + report.keyLabel + '・' + report.notes + '音</strong>';
    if (!report.issues.length) {
      body.innerHTML = head + '<p class="checkup-ok">問題は見つかりませんでした。このまま歌わせられます。</p>';
      button.hidden = true;
      return;
    }
    body.innerHTML = head + '<ul class="checkup-list">' + report.issues.map(function (issue) {
      return '<li class="checkup-' + issue.level + '">' +
        String(issue.text).replace(/[<>&]/g, "") +
        (issue.fixable ? '' : '<span class="checkup-manual">自動では直せません</span>') + '</li>';
    }).join("") + '</ul>';
    button.hidden = !report.repairable;
  }

  function repairMelody() {
    if (!song || !midiDoctor) return;
    var result = midiDoctor.repair(song);
    if (!result.changed) { showToast("直すところはありませんでした"); return; }
    invalidateVocal("メロディを直したため、古い歌声を外しました");
    renderSong();
    showToast(result.log.join(" / "));
    $("transportStatus").textContent = "メロディを直しました。再生して確かめてください。";
  }

  function invalidateVocal(reason) {
    if (!audio.hasVocal()) return;
    audio.clearVocal();
    stage.setHead(-1);
    $("playBtn").textContent = "▶ 再生";
    $("transportStatus").textContent = "歌声WAVを外しました。";
    syncVocalUI();
    showToast(reason || "メロディが変わったため、古い歌声を外しました");
  }

  /* 伴奏と歌声を混ぜた完成音源のWAVを保存する。
     再生を使わずオフラインで作るので、曲の長さぶん待つ必要はない。 */
  /* 配布版は環境を選ばないブラウザのダウンロードで保存する。
     ローカル歌唱版だけは、この関数を差し替えてサーバー保存にしている。 */
  function saveWavFile(bytes, filename) {
    download(bytes, "audio/wav", filename);
    return Promise.resolve({ path:null, name:filename });
  }

  var exportingMix = false;
  function exportMixWav() {
    if (!song) { showToast("先に曲をつくってください"); return; }
    if (exportingMix) return;
    if (!audio.canExportMix || !audio.canExportMix()) {
      showToast("この音源では書き出せません。SoundFontを読み込むか、内蔵音源に切り替えてください");
      return;
    }
    var button = $("exportMixBtn");
    var label = button.textContent;
    exportingMix = true;
    button.disabled = true;
    button.textContent = "書き出し中…";
    showToast(audio.hasVocal() ? "伴奏と歌声を混ぜています…" : "伴奏だけを書き出しています（歌声は未読み込み）");

    /* レンダリングは重いので、ボタンの表示が変わってから始める。 */
    setTimeout(function () {
      Promise.resolve()
        .then(function () { return audio.exportMix(song, bpm, soundSet()); })
        .then(function (result) {
          var filename = safeName() + (result.hadVocal ? "-歌入り" : "-伴奏") + ".wav";
          var minutes = Math.floor(result.durationSeconds / 60);
          var seconds = Math.round(result.durationSeconds % 60);
          var note = result.normalizedBy < 1
            ? "（音が割れないよう全体を" + Math.round(result.normalizedBy * 100) + "%に下げました）" : "";
          return saveWavFile(result.bytes, filename).then(function (saved) {
            showToast((saved.path ? "ダウンロードフォルダに保存しました " + saved.name : "WAVを保存しました " + filename) +
              " / " + minutes + "分" + seconds + "秒" + note);
          });
        })
        .catch(function (error) { showToast(error && error.message ? error.message : "書き出しに失敗しました"); })
        .then(function () {
          exportingMix = false;
          button.disabled = false;
          button.textContent = label;
        });
    }, 30);
  }

  function exportVocalScore() {
    if (!song) { showToast("先に曲をつくってください"); return; }
    try {
      var xml = musicxml.build(song, bpm, $("titleInput").value.trim());
      download(xml, "application/vnd.recordare.musicxml+xml", safeName() + ".musicxml");
      showToast("NEUTRINO用MusicXMLを保存しました");
    } catch (error) { showToast(error.message); }
  }

  function loadVocalFile(file) {
    if (!file) return;
    if (file.size > 256 * 1024 * 1024) { showToast("WAVは256MB以下のファイルを選んでください"); return; }
    var reader = new FileReader();
    $("vocalStatus").textContent = "歌声WAVを読み込んでいます…";
    reader.onload = function () {
      audio.loadVocal(reader.result, file.name).then(function () {
        audio.setVocalVolume(+$("vocalVolume").value / 100);
        stage.setHead(-1);
        $("playBtn").textContent = "▶ 再生";
        $("transportStatus").textContent = "歌声WAVを読み込みました。";
        syncVocalUI();
        showToast("歌声WAVを読み込みました。再生すると伴奏と重なります");
      }).catch(function () {
        audio.clearVocal(); syncVocalUI();
        $("transportStatus").textContent = "歌声WAVを読み込めませんでした。WAV形式と容量を確認してください。";
        showToast("このWAVを読み込めませんでした（256MB以下のPCM WAV推奨）");
      });
    };
    reader.onerror = function () { syncVocalUI(); showToast("WAVファイルを開けませんでした"); };
    reader.readAsArrayBuffer(file);
  }

  function midiSettings() {
    var melodyInstrument = presets.byId(presets.TIMBRES, partMix.melody.instrument);
    var chordInstrument = presets.byId(presets.TIMBRES, partMix.chord.instrument);
    var bassInstrument = presets.byId(presets.TIMBRES, partMix.bass.instrument);
    return {
      programs: { melody: melodyInstrument.program, pad: chordInstrument.program, bass: bassInstrument.bassProgram },
      enabled: {
        melody: partMix.melody.enabled,
        pad: partMix.chord.enabled,
        bass: partMix.bass.enabled,
        drum: partMix.drum.enabled
      }
    };
  }

  function songFingerprint() {
    if (!song) return "未生成";
    var payload = JSON.stringify({
      melody:song.melody,
      chords:song.chords,
      bass:song.bass,
      pad:song.pad,
      drum:song.drum,
      extraTracks:song.extraTracks || [],
      importedTracks:song.importedTracks || [],
      totalSteps:song.totalSteps,
      key:song.key
    });
    var hash = 2166136261;
    for (var i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function syncAudioDevFingerprint() {
    var output = $("audioSongFingerprint");
    if (output) output.textContent = songFingerprint();
  }

  function resetTransportForBackendChange() {
    audio.stop();
    if (stage) stage.setHead(-1);
    $("playBtn").textContent = "▶ 再生";
  }

  function describeBackendStatus(state) {
    if (!state) return "Current Synth";
    if (state.fallback) {
      return "Current Synthへfallback（" + (state.fallback.message || state.fallback.reason) + "）";
    }
    return state.activeBackend === "spessasynth" ? "SpessaSynth / local SoundFont" : "Current Synth";
  }

  function initAudioDevMode() {
    // ZEN edition uses only the built-in Web Audio synthesizer.
  }

  function sectionLabel(kind) {
    return { intro:"イントロ", verseA:"Aメロ候補", verseB:"Bメロ候補", chorus:"サビ候補",
      bridge:"Cメロ候補", outro:"アウトロ" }[kind] || "歌詞";
  }

  function showCount() {
    lyricsAnalysis = lyricsAnalyzer.analyze($("lyrics").value, { title:$("titleInput").value, mode:"standard" });
    var box = $("count");
    box.innerHTML = "";
    $("meterSummary").textContent = lyricsAnalysis.stats.lineCount + "行・" +
      lyricsAnalysis.stats.moraCount + "モーラ（文字数ではなく歌の音数）";
    if (!lyricsAnalysis.meter.length) {
      box.classList.remove("is-collapsed");
      $("meterToggleBtn").hidden = true;
      var empty = document.createElement("p");
      empty.className = "meter-empty"; empty.textContent = "歌詞を入力すると、行ごとの長さと区切りを表示します。";
      box.appendChild(empty); return lyricsAnalysis;
    }
    lyricsAnalysis.meter.forEach(function (item) {
      var row = document.createElement("article");
      row.className = "meter-row " + item.densityLevel;
      var top = document.createElement("div"); top.className = "meter-line";
      var number = document.createElement("b"); number.textContent = (item.lineIndex + 1) + "行目";
      var section = document.createElement("span"); section.className = "meter-section";
      section.textContent = sectionLabel(item.sectionKind);
      var count = document.createElement("strong"); count.textContent = item.moraCount + "モーラ";
      top.appendChild(number); top.appendChild(section); top.appendChild(count);
      var text = document.createElement("p"); text.className = "meter-text"; text.textContent = item.text;
      var detail = document.createElement("div"); detail.className = "meter-detail";
      var groups = document.createElement("span"); groups.className = "meter-groups";
      groups.textContent = "区切りの目安　" + item.groups.join("｜");
      var density = document.createElement("span"); density.className = "meter-density";
      density.textContent = item.densityLabel;
      detail.appendChild(groups); detail.appendChild(density);
      var guidance = document.createElement("small");
      guidance.textContent = item.guidance.slice(1).join("　");
      row.appendChild(top); row.appendChild(text); row.appendChild(detail);
      if (guidance.textContent) row.appendChild(guidance);
      box.appendChild(row);
    });
    var hasHiddenRows = lyricsAnalysis.meter.length > 6;
    box.classList.toggle("is-collapsed", hasHiddenRows && !meterExpanded);
    $("meterToggleBtn").hidden = !hasHiddenRows;
    $("meterToggleBtn").textContent = meterExpanded
      ? "最初の6行だけ表示"
      : "全" + lyricsAnalysis.meter.length + "行を表示";
    return lyricsAnalysis;
  }

  function showDetail() {
    if (song && song.importedMidi) {
      var info = song.importedMidiInfo || {};
      $("detail").innerHTML = '<span>' + (song.blueprintImported ? 'AI設計図' : 'MIDI') + '</span>' + (Number(info.trackCount) || 0) + 'トラック' +
        '<span>音符</span>' + (Number(info.noteCount) || 0) + '<span>速さ</span>' + bpm + ' BPM' +
        '<span>小節</span>' + (Number(song.bars) || 0);
      $("stageName").textContent = $("titleInput").value.trim() || (song.blueprintImported ? "AI設計図" : "読み込んだMIDI");
      return;
    }
    var progression = presets.byId(presets.PROGRESSIONS, current("progression"));
    var rhythm = presets.byId(presets.RHYTHMS, current("rhythm"));
    var ensemble = presets.byId(presets.ENSEMBLES, partMix.ensembleId);
    var html = '<span>進行</span>' + progression.name + '<span>リズム</span>' + rhythm.name +
      '<span>編成</span>' + (partMix.ensembleId === "custom" ? "カスタム" : ensemble.name) +
      '<span>速さ</span>' + bpm + " BPM";
    if (song) html += '<span>キー</span>' + theory.keyLabel(song.key) + '<span>小節</span>' + (Number(song.bars) || 0);
    $("detail").innerHTML = html;
    $("stageName").textContent = $("titleInput").value.trim() || "まだ名前のない曲";
  }

  function chordChoiceGroups(key, currentChord) {
    var romans = ["I", "II", "III", "IV", "V", "VI", "VII"];
    var groups = [], seen = {};
    function group(label) { var value = { label: label, items: [] }; groups.push(value); return value; }
    function add(target, chord, label) {
      var value = chord.root + ":" + chord.type;
      if (seen[value]) return;
      seen[value] = true;
      target.items.push({ value: value, label: label + " · " + theory.chordName(chord) });
    }
    var currentGroup = group("現在のコード");
    add(currentGroup, currentChord, "現在");
    var diatonic = group("この調で使いやすいコード");
    for (var degree = 0; degree < 7; degree++) {
      var base = theory.chordOfDegree(key, degree, "auto");
      add(diatonic, base, romans[degree]);
      var seventh = base.type === "maj" ? (degree === 4 ? "dom7" : "maj7") :
        (base.type === "min" ? "min7" : "m7b5");
      add(diatonic, { root: base.root, type: seventh }, romans[degree] + " 7th");
    }
    var colors = group(theory.NAMES[currentChord.root] + "を根音にした響き");
    Object.keys(theory.CHORD_SHAPES).forEach(function (type) {
      add(colors, { root: currentChord.root, type: type }, "同じ根音");
    });
    var chromatic = group("全12音の基本コード");
    for (var root = 0; root < 12; root++) {
      ["maj", "min", "dom7"].forEach(function (type) {
        add(chromatic, { root: root, type: type }, theory.NAMES[root]);
      });
    }
    return groups.filter(function (entry) { return entry.items.length; });
  }

  function renderChordEditor() {
    var box = $("chordEditor");
    box.innerHTML = "";
    if (!song) return;
    song.chords.forEach(function (chord, index) {
      var slot = document.createElement("div");
      slot.className = "chord-slot";
      var label = document.createElement("label");
      label.textContent = "進行 " + (index + 1);
      var select = document.createElement("select");
      chordChoiceGroups(song.key, chord).forEach(function (choiceGroup) {
        var optgroup = document.createElement("optgroup");
        optgroup.label = choiceGroup.label;
        choiceGroup.items.forEach(function (choice) {
          var option = document.createElement("option");
          option.value = choice.value; option.textContent = choice.label;
          optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
      });
      select.value = chord.root + ":" + chord.type;
      select.addEventListener("change", function () {
        var parts = this.value.split(":");
        song.chords[index] = { root: +parts[0], type: parts[1] };
        rebuildBacking();
        renderChordEditor();
        showDetail();
        showToast((index + 1) + "小節目を " + theory.chordName(song.chords[index]) + " に変更しました");
      });
      slot.appendChild(label); slot.appendChild(select); box.appendChild(slot);
    });
  }

  function renderDrumGrid() {
    var box = $("drumGrid");
    box.innerHTML = "";
    if (!song || song.importedMidi) return;
    var rhythm = presets.byId(presets.RHYTHMS, current("rhythm"));
    var pattern = customDrum || editor.patternFromRhythm(rhythm);
    [{ key: "kick", label: "Kick" }, { key: "snare", label: "Snare" }, { key: "hat", label: "Hi-Hat" }].forEach(function (row) {
      var label = document.createElement("span");
      label.className = "drum-label"; label.textContent = row.label; box.appendChild(label);
      for (var step = 0; step < 16; step++) {
        (function (kind, at) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "drum-step" + (at % 4 === 0 ? " beat" : "");
          button.setAttribute("aria-label", row.label + " " + (at + 1));
          button.setAttribute("aria-pressed", pattern[kind].indexOf(at) >= 0 ? "true" : "false");
          button.addEventListener("click", function () {
            customDrum = editor.togglePattern(customDrum || pattern, kind, at);
            song.drum = editor.buildDrums(customDrum, song.bars);
            renderDrumGrid();
            stage.redraw();
          });
          box.appendChild(button);
        })(row.key, step);
      }
    });
  }

  function rebuildBacking() {
    if (!song) return;
    var rhythm = presets.byId(presets.RHYTHMS, current("rhythm"));
    var backing = compose.backing(song.melody, song.chords, rhythm);
    song.bass = backing.bass; song.pad = backing.pad; song.bars = backing.bars;
    song.drum = customDrum ? editor.buildDrums(customDrum, backing.bars) : backing.drum;
    if (performancePass) performancePass.apply(song, lyricsAnalysis, song.candidateInfo || {}, {
      drumVariation:!customDrum
    });
    arrangementTemplate.apply(song, arrangementTemplateId, theory);
    stage.setSong(song, song.key);
    syncAudioDevFingerprint();
  }

  function renderSong() {
    $("studio").hidden = !song;
    $("studio").classList.toggle("imported-midi", !!(song && song.importedMidi));
    var midiSummary = $("midiImportSummary");
    midiSummary.hidden = !(song && song.importedMidi);
    if (song && song.importedMidi) {
      var info = song.importedMidiInfo || {}, chips = (song.importedTracks || []).map(function (track) {
        return '<span>' + String(track.name || "Track").replace(/[<>&]/g, "") +
          (track.isDrum ? ' · Drums' : ' · GM ' + (track.program + 1)) + '</span>';
      }).join("");
      var blueprintStats = song.blueprintDiagnostics && song.blueprintDiagnostics.stats || {};
      var blueprintWarnings = song.blueprintDiagnostics && song.blueprintDiagnostics.warnings || [];
      midiSummary.innerHTML = '<strong>' + (song.blueprintImported ? 'AI設計図をそのまま演奏します' : '読み込んだMIDIをそのまま演奏します') + '</strong>' +
        (Number(info.trackCount) || 0) + 'トラック・' + (Number(info.noteCount) || 0) + '音・' + bpm + ' BPM。' +
        '内蔵の簡易音源で試聴します。元の音源の音色を完全には再現しません。' +
        (song.blueprintImported ? ' 歌唱音' + (Number(blueprintStats.vocalNoteCount) || 0) + '個、検査警告' + (Number(blueprintWarnings.length) || 0) + '件。' : '') +
        '<div class="midi-track-chips">' + chips + '</div>';
    }
    renderCheckup();
    stage.setSong(song, song && song.key);
    renderChordEditor();
    renderDrumGrid();
    showDetail();
    syncAudioDevFingerprint();
  }

  function renderCandidates() {
    var box = $("candidateList");
    box.innerHTML = "";
    candidates.forEach(function (candidate, index) {
      var info = candidate.candidateInfo || {
        letter:String.fromCharCode(65 + index), name:index ? "候補" : "保存した案",
        note:index ? "生成したメロディ案" : "保存した曲を編集します"
      };
      var button = document.createElement("button");
      button.type = "button";
      button.className = "candidate-option";
      button.setAttribute("aria-pressed", index === activeCandidateIndex ? "true" : "false");
      var letter = document.createElement("span");
      letter.className = "candidate-letter"; letter.textContent = info.letter || String.fromCharCode(65 + index);
      var copy = document.createElement("span"); copy.className = "candidate-copy";
      var strong = document.createElement("strong"); strong.textContent = info.name || "候補";
      var small = document.createElement("small"); small.textContent = info.note || "聴いて比べる曲案";
      copy.appendChild(strong); copy.appendChild(small); button.appendChild(letter); button.appendChild(copy);
      button.addEventListener("click", function () { selectCandidate(index); });
      box.appendChild(button);
    });
  }

  function selectCandidate(index) {
    if (!candidates[index] || index === activeCandidateIndex && song === candidates[index]) return;
    audio.stop(); stage.setHead(-1); invalidateVocal("曲案を変えたため、古い歌声を外しました");
    $("playBtn").textContent = "▶ 再生";
    activeCandidateIndex = index;
    song = candidates[index];
    customDrum = null;
    renderCandidates(); renderSong();
    $("transportStatus").textContent = "案" + (song.candidateInfo ? song.candidateInfo.letter : index + 1) + "を選びました。再生して確認できます。";
  }

  function rebuildCandidateArrangement(candidate, heldChords, heldDrum) {
    if (heldChords && heldChords.length) candidate.chords = heldChords.map(function (chord) {
      return { root:chord.root, type:chord.type };
    });
    if (heldChords || heldDrum) {
      var backing = compose.backing(candidate.melody, candidate.chords, candidate.rhythm);
      candidate.bass = backing.bass; candidate.pad = backing.pad; candidate.bars = backing.bars;
      candidate.drum = heldDrum ? editor.buildDrums(heldDrum, backing.bars) : backing.drum;
      if (performancePass) performancePass.apply(candidate, lyricsAnalysis, candidate.candidateInfo || {}, {
        drumVariation:!heldDrum
      });
    }
    arrangementTemplate.apply(candidate, arrangementTemplateId, theory);
  }

  function makeSong(freshMelody, preserveArrangement, scrollToSong, preferredCandidateIndex) {
    setImportedMidiMode(false);
    var analysis = showCount();
    /* LyricsAnalyzerが除外した[Aメロ]等の見出しは、歌唱文字として作曲器へ渡さない。 */
    var compositionText = analysis.lines.map(function (line) { return line.text; }).join("\n");
    var parsed = mora.parse(compositionText);
    if (!parsed.phrases.length) {
      song = null; stage.setSong(null, null); showToast("歌詞を1文字以上書いてください"); return;
    }
    $("warn").textContent = parsed.unknown.length
      ? "読みが分からない字：" + parsed.unknown.join(" ") + "　→ 漢字(かんじ) のように読みを書いてください"
      : "";
    $("warn").hidden = !parsed.unknown.length;
    if (song) invalidateVocal();

    var heldChords = preserveArrangement && song ? song.chords.map(function (chord) { return { root: chord.root, type: chord.type }; }) : null;
    var heldDrum = preserveArrangement ? customDrum : null;
    if (freshMelody) seed = (seed + 104729) >>> 0;
    if (!preserveArrangement) customDrum = null;
    updateRecipeFromControls();
    override.range = $("rangeSel").value;
    override.contour = $("motionSel").value;
    bpm = safeBpm(override.bpm !== undefined ? override.bpm : mood.bpm);
    candidates = songSketch.buildCandidates(parsed.phrases, analysis, recipe, activeMood(), seed, override);
    candidates.forEach(function (candidate) { rebuildCandidateArrangement(candidate, heldChords, heldDrum); });
    activeCandidateIndex = Math.max(0, Math.min(preferredCandidateIndex || 0, candidates.length - 1));
    song = candidates[activeCandidateIndex];
    customDrum = heldDrum;
    renderCandidates();
    renderSong();
    syncControls();
    $("transportStatus").textContent = "3案できました。A・B・Cを再生して、近い案を選んでください。";
    if (scrollToSong) $("studio").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function shiftMelody(amount) {
    if (!song) return;
    invalidateVocal();
    song.melody = editor.shiftMelody(song.melody, amount, song.key);
    var range = editor.noteRange(song.melody);
    song.lo = range.lo; song.hi = range.hi;
    if (song.importedMidi) renderSong();
    else rebuildBacking();
    showToast(amount > 0 ? "メロディを高くしました" : "メロディを低くしました");
  }

  function download(bytes, mime, filename) {
    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    var anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function safeName() {
    return ($("titleInput").value.trim() || "uta-genkou").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  }

  function stateForSave() {
    return {
      title: $("titleInput").value,
      lyrics: $("lyrics").value,
      moodId: mood.id,
      styleId: style.id,
      seed: seed,
      override: override,
      recipe: recipe,
      bpm: bpm,
      customDrum: customDrum,
      partMix: partMix,
      arrangementTemplateId: arrangementTemplateId,
      vocalSettings: { leadSteps:+$("vocalLeadSel").value, volume:+$("vocalVolume").value },
      song: song
    };
  }

  function saveProject() {
    if (!song) { showToast("先に曲をつくってください"); return; }
    download(projectFile.encode(stateForSave()), "application/json", safeName() + ".utagenkou.json");
    showToast("プロジェクトを保存しました");
  }

  function loadMidiFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast("MIDIファイルが大きすぎます（20MBまで）"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = smf.parse(reader.result);
        var importedSong = smf.toSong(parsed, { fileName:file.name });
        audio.stop(); audio.clearVocal(); syncVocalUI();
        setImportedMidiMode(true);
        bpm = importedBpm(parsed.bpm);
        override.bpm = bpm;
        song = importedSong;
        song.candidateInfo = { letter:"M", name:"読み込んだMIDI", note:"全トラックを保持して再生します" };
        candidates = [song]; activeCandidateIndex = 0; customDrum = null;
        arrangementTemplateId = "free";
        $("titleInput").value = file.name.replace(/\.(?:mid|midi)$/i, "") || "読み込んだMIDI";
        if (song.importedMidiInfo.lyricText) $("lyrics").value = song.importedMidiInfo.lyricText;
        stage.setHead(-1); $("playBtn").textContent = "▶ 再生";
        showCount(); syncControls(); renderCandidates(); renderSong();
        var lyricStatus = song.importedMidiInfo.lyricEvents
          ? " 歌詞" + song.importedMidiInfo.lyricEvents + "行を歌唱トラックへ割り当てました。"
          : " 歌詞イベントは入っていません。";
        $("transportStatus").textContent = parsed.tracks.length + "トラックのMIDIを開きました。" + lyricStatus;
        showToast("MIDIを読み込みました（" + parsed.tracks.length + "トラック）" + lyricStatus);
        $("studio").scrollIntoView({ behavior:"smooth", block:"start" });
      } catch (error) {
        $("transportStatus").textContent = "MIDIを読み込めませんでした。";
        showToast(error && error.message ? error.message : "MIDIを読み込めませんでした");
      }
    };
    reader.onerror = function () { showToast("MIDIファイルを開けませんでした"); };
    reader.readAsArrayBuffer(file);
  }

  function setBlueprintStatus(message, kind) {
    var status = $("blueprintStatus");
    status.textContent = message;
    if (kind) status.dataset.kind = kind;
    else status.removeAttribute("data-kind");
  }

  function openBlueprintDialog() {
    var dialog = $("blueprintDialog");
    setBlueprintStatus("見本を入れるか、GPT / Geminiから返ったJSONを貼り付けてください。", "");
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function closeBlueprintDialog() {
    var dialog = $("blueprintDialog");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }

  function clipboardCopy(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = value; area.setAttribute("readonly", "");
      area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      try { document.execCommand("copy") ? resolve() : reject(new Error("copy failed")); }
      catch (error) { reject(error); }
      document.body.removeChild(area);
    });
  }

  function applyBlueprintText(source) {
    try {
      var result = blueprint.parse(source);
      audio.stop(); audio.clearVocal(); syncVocalUI();
      setImportedMidiMode(true);
      bpm = importedBpm(result.blueprint.bpm);
      override.bpm = bpm;
      song = result.song;
      song.candidateInfo = { letter:"AI", name:"AI設計図", note:"入力された全トラックを保持して演奏します" };
      candidates = [song]; activeCandidateIndex = 0; customDrum = null;
      arrangementTemplateId = "free";
      $("titleInput").value = result.blueprint.title || "AI設計図";
      $("lyrics").value = result.blueprint.lyrics || "";
      stage.setHead(-1); $("playBtn").textContent = "▶ 再生";
      showCount(); syncControls(); renderCandidates(); renderSong();
      var warnings = result.diagnostics.warnings;
      var message = result.song.importedTracks.length + "トラックのAI設計図を開きました。" +
        (warnings.length ? " 警告" + warnings.length + "件は『曲の健康診断』で確認できます。" : " 検査警告はありません。");
      $("transportStatus").textContent = message;
      setBlueprintStatus(message, "ok");
      closeBlueprintDialog(); showToast(message);
      $("studio").scrollIntoView({ behavior:"smooth", block:"start" });
    } catch (error) {
      var message = error && error.message ? error.message : "設計図を開けませんでした";
      setBlueprintStatus(message, "error");
      showToast(message);
    }
  }

  function loadBlueprintFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setBlueprintStatus("設計図は2MBまでです。", "error"); return; }
    var reader = new FileReader();
    reader.onload = function () { $("blueprintText").value = reader.result; applyBlueprintText(reader.result); };
    reader.onerror = function () { setBlueprintStatus("JSONファイルを開けませんでした。", "error"); };
    reader.readAsText(file, "utf-8");
  }

  function loadProject(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("プロジェクトファイルが大きすぎます"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var state = projectFile.decode(reader.result);
        mood = presets.byId(presets.MOODS, state.moodId);
        style = styles.byId(state.styleId || "auto");
        seed = Number.isFinite(state.seed) ? state.seed : 20260810;
        override = state.override || {};
        recipe = state.recipe || defaultRecipe();
        song = state.song;
        setImportedMidiMode(!!song.importedMidi);
        bpm = importedMidiMode ? importedBpm(state.bpm) : safeBpm(state.bpm !== undefined ? state.bpm : mood.bpm);
        override.bpm = importedMidiMode ? bpm : safeBpm(override.bpm !== undefined ? override.bpm : bpm);
        candidates = [song];
        activeCandidateIndex = 0;
        customDrum = state.customDrum || null;
        partMix = normalizePartMix(state.partMix || partsFromEnsemble(mood.ensemble));
        arrangementTemplateId = arrangementTemplate.byId(state.arrangementTemplateId || "free").id;
        audio.clearVocal();
        stage.setHead(-1);
        $("playBtn").textContent = "▶ 再生";
        $("transportStatus").textContent = "プロジェクトを開きました。歌声WAVは必要なら開き直してください。";
        $("vocalLeadSel").value = state.vocalSettings && state.vocalSettings.leadSteps !== undefined
          ? state.vocalSettings.leadSteps : musicxml.LEAD_STEPS;
        $("vocalVolume").value = state.vocalSettings && state.vocalSettings.volume !== undefined
          ? state.vocalSettings.volume : 100;
        $("vocalVolumeVal").textContent = $("vocalVolume").value + "%";
        syncVocalUI();
        $("titleInput").value = state.title || "まだ名前のない曲";
        $("lyrics").value = state.lyrics;
        showCount(); updateMoodButtons(); updateStyleButtons(); syncControls(); renderCandidates(); renderSong();
        showToast("プロジェクトを開きました");
      } catch (error) { showToast(error.message); }
    };
    reader.readAsText(file, "utf-8");
  }

  function bindEvents() {
    $("makeBtn").addEventListener("click", function () { makeSong(false, false, true); });
    $("reMelodyBtn").addEventListener("click", function () { makeSong(true, true, true); });
    $("newCandidatesBtn").addEventListener("click", function () { makeSong(true, false, false); });
    $("motifBtn").addEventListener("click", function () {
      if (!song) return;
      invalidateVocal("メロディを変えたため、古い歌声を外しました");
      var repeated = songSketch.strengthenMotif(song, lyricsAnalysis);
      renderSong();
      showToast(repeated ? "似たフレーズを反復して、覚えやすさを強めました" : "反復できる近い長さのフレーズがありませんでした");
    });
    $("chorusLiftBtn").addEventListener("click", function () {
      if (!song) return;
      invalidateVocal("メロディを変えたため、古い歌声を外しました");
      var lifted = songSketch.liftChorus(song, lyricsAnalysis);
      renderSong();
      showToast(lifted ? "サビ候補を少し高くしました" : "サビ候補が見つかりませんでした");
    });
    $("titleInput").addEventListener("input", function () { showDetail(); showCount(); });
    $("lyrics").addEventListener("input", showCount);
    $("meterToggleBtn").addEventListener("click", function () {
      meterExpanded = !meterExpanded;
      showCount();
    });

    function openHelp() {
      var dialog = $("helpDialog");
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    function closeHelp() {
      var dialog = $("helpDialog");
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
    $("helpBtn").addEventListener("click", openHelp);
    $("helpCloseBtn").addEventListener("click", closeHelp);
    $("helpStartBtn").addEventListener("click", function () {
      closeHelp();
      $("lyrics").focus();
      $("lyrics").scrollIntoView({ behavior:"smooth", block:"center" });
    });

    $("blueprintBtn").addEventListener("click", openBlueprintDialog);
    $("blueprintCloseBtn").addEventListener("click", closeBlueprintDialog);
    $("blueprintCancelBtn").addEventListener("click", closeBlueprintDialog);
    $("blueprintSampleBtn").addEventListener("click", function () {
      $("blueprintText").value = blueprint.sample();
      setBlueprintStatus("4小節の見本を入れました。そのまま『この設計図を開く』で試せます。", "ok");
    });
    $("blueprintPromptBtn").addEventListener("click", function () {
      clipboardCopy(blueprint.prompt() + "\n\n見本JSON:\n" + blueprint.sample()).then(function () {
        setBlueprintStatus("GPT / Gemini用の指示と見本JSONをコピーしました。", "ok");
        showToast("GPT / Gemini用の指示をコピーしました");
      }).catch(function () {
        setBlueprintStatus("自動コピーできませんでした。見本を入れて、テキストを手動でコピーしてください。", "error");
      });
    });
    $("blueprintApplyBtn").addEventListener("click", function () { applyBlueprintText($("blueprintText").value); });
    $("blueprintFileBtn").addEventListener("click", function () { $("blueprintFile").click(); });
    $("blueprintFile").addEventListener("change", function () { loadBlueprintFile(this.files[0]); this.value = ""; });

    $("arrangementTemplateSel").addEventListener("change", function () {
      arrangementTemplateId = arrangementTemplate.byId(this.value).id;
      var template = arrangementTemplate.byId(arrangementTemplateId);
      if (template.id !== "free") {
        mood = presets.byId(presets.MOODS, "hashiru");
        recipe.key = { root:template.key.root, mode:template.key.mode };
        override.progression = template.progression;
        override.rhythm = template.rhythm;
        override.bpm = safeBpm(template.bpm);
        bpm = override.bpm;
        partMix = partsFromEnsemble(template.ensemble);
        partMix.melody.instrument = template.melody;
        partMix.chord.instrument = template.chord;
        partMix.bass.instrument = template.bass;
        partMix.drum.kit = template.drum;
        updateMoodButtons();
      }
      syncControls(); showDetail();
      if (song) makeSong(false, false, false);
      showToast(template.id === "free" ? "自由設定に戻しました" : "疾走ポップの編成とコードを適用しました");
    });

    ["keySel", "modeSel", "progSel", "motionSel", "rangeSel"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        if (id === "progSel") { override.progression = this.value; arrangementTemplateId = "free"; }
        else if (id === "keySel" || id === "modeSel") arrangementTemplateId = "free";
        else if (id === "motionSel") override.contour = this.value;
        else if (id === "rangeSel") override.range = this.value;
        if (song) makeSong(false, false, false); else { updateRecipeFromControls(); showDetail(); }
      });
    });
    $("rhythmSel").addEventListener("change", function () {
      override.rhythm = this.value; customDrum = null;
      if (song) makeSong(false, false, false); else showDetail();
    });
    $("bpmSel").addEventListener("input", function () {
      override.bpm = importedMidiMode ? importedBpm(this.value) : safeBpm(this.value); bpm = override.bpm; this.value = bpm; $("bpmVal").textContent = bpm + " BPM"; showDetail();
      if (song) $("transportStatus").textContent = "指を離すと、このテンポに合わせて歌唱時間を整え直します。";
    });
    $("bpmSel").addEventListener("change", function () {
      override.bpm = importedMidiMode ? importedBpm(this.value) : safeBpm(this.value); bpm = override.bpm; this.value = bpm;
      if (!song) return;
      var keepCandidate = activeCandidateIndex;
      audio.stop(); stage.setHead(-1); $("playBtn").textContent = "▶ 再生";
      if (importedMidiMode) {
        $("transportStatus").textContent = bpm + " BPMで読み込んだMIDIを再生します。音符配置は変更していません。";
        renderSong();
        return;
      }
      invalidateVocal("テンポが変わったため、古い歌声を外しました");
      makeSong(false, true, false, keepCandidate);
      $("transportStatus").textContent = bpm + " BPMに合わせて、発音時間とブレスを整え直しました。";
    });
    $("resetTweak").addEventListener("click", function () {
      override = {}; customDrum = null; arrangementTemplateId = "free"; partMix = partsFromEnsemble(mood.ensemble);
      syncControls();
      if (song) makeSong(false, false, false); else showDetail();
    });

    $("ensembleSel").addEventListener("change", function () {
      partMix = partsFromEnsemble(this.value); syncPartControls(); showDetail();
      showToast("楽器編成を「" + presets.byId(presets.ENSEMBLES, this.value).name + "」にしました");
    });
    ["melody", "chord", "bass"].forEach(function (part) {
      $(part + "Enabled").addEventListener("change", function () {
        partMix[part].enabled = this.checked; markCustomEnsemble();
      });
      $(part + "Instrument").addEventListener("change", function () {
        partMix[part].instrument = this.value; markCustomEnsemble();
      });
    });
    $("drumEnabled").addEventListener("change", function () {
      partMix.drum.enabled = this.checked; markCustomEnsemble();
    });
    $("drumKit").addEventListener("change", function () {
      partMix.drum.kit = this.value; markCustomEnsemble();
    });

    $("playBtn").addEventListener("click", function () {
      if (!song) return;
      if (audio.isPlaying()) {
        audio.stop(); stage.setHead(-1); this.textContent = "▶ 再生"; $("transportStatus").textContent = "停止しました。"; return;
      }
      this.textContent = "■ 停止";
      var backendState = audio.status();
      $("transportStatus").textContent = "再生しています（" +
        (backendState.activeBackend === "spessasynth" ? "SpessaSynth" : "Current Synth") + "）。";
      var button = this;
      audio.play(song, bpm, soundSet(), function (head) {
        stage.setHead(head);
        if (head < 0) { button.textContent = "▶ 再生"; $("transportStatus").textContent = "再生が終わりました。"; }
      }).catch(function () {
        button.textContent = "▶ 再生";
        $("transportStatus").textContent = "再生できませんでした。";
        showToast("再生バックエンドでエラーが発生しました");
      });
    });

    $("melodyOctaveDown").addEventListener("click", function () { shiftMelody(-12); });
    $("melodyDown").addEventListener("click", function () { shiftMelody(-2); });
    $("melodyUp").addEventListener("click", function () { shiftMelody(2); });
    $("melodyOctaveUp").addEventListener("click", function () { shiftMelody(12); });

    $("exportBtn").addEventListener("click", function () {
      if (!song) return;
      download(smf.build(song, bpm, midiSettings()), "audio/midi", safeName() + ".mid");
      showToast("MIDIを書き出しました");
    });
    $("exportMixBtn").addEventListener("click", exportMixWav);
    $("midiRepairBtn").addEventListener("click", repairMelody);
    $("vocalScoreBtn").addEventListener("click", exportVocalScore);
    $("vocalScoreBtn2").addEventListener("click", exportVocalScore);
    $("vocalFileBtn").addEventListener("click", function () { $("vocalFile").click(); });
    $("vocalFile").addEventListener("change", function () { loadVocalFile(this.files[0]); this.value = ""; });
    $("vocalVolume").addEventListener("input", function () {
      $("vocalVolumeVal").textContent = this.value + "%";
      if (audio.hasVocal()) audio.setVocalVolume(+this.value / 100);
    });
    $("removeVocalBtn").addEventListener("click", function () {
      audio.clearVocal(); syncVocalUI(); stage.setHead(-1); $("playBtn").textContent = "▶ 再生";
      $("transportStatus").textContent = "歌声WAVを外しました。";
    });
    $("saveProjectBtn").addEventListener("click", saveProject);
    $("loadMidiBtn").addEventListener("click", function () { $("midiFile").click(); });
    $("midiFile").addEventListener("change", function () { loadMidiFile(this.files[0]); this.value = ""; });
    $("loadProjectBtn").addEventListener("click", function () { $("projectFile").click(); });
    $("projectFile").addEventListener("change", function () { loadProject(this.files[0]); this.value = ""; });
  }

  function init() {
    stage = UG.view.create($("cv"), $("scroller"));
    stage.onEdit(function () {
      invalidateVocal();
      var range = editor.noteRange(song.melody); song.lo = range.lo; song.hi = range.hi; showDetail();
    });
    fillSelects(); buildMoodButtons(); buildStyleButtons(); syncControls(); bindEvents(); initAudioDevMode();
    showCount(); syncVocalUI();
    document.documentElement.dataset.appReady = "true";
  }

  window.addEventListener("beforeunload", function () { audio.dispose(); });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.UG);
