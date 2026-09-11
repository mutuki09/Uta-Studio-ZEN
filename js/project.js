/* project.js — サーバーを使わず、編集状態をJSONへ保存・復元する。 */
(function (root) {
  "use strict";

  var FORMAT = "uta-genkou-studio";
  var VERSION = 1;

  function validNote(note) {
    return note && Number.isFinite(note.s) && Number.isFinite(note.d) && Number.isFinite(note.n) &&
      note.s >= 0 && note.s <= 1000000 && note.d > 0 && note.d <= 100000 && note.n >= 0 && note.n <= 127;
  }

  function validChord(chord) {
    return chord && Number.isFinite(chord.root) && chord.root >= 0 && chord.root <= 11 &&
      typeof chord.type === "string" && chord.type.length <= 20;
  }

  function validDrum(drum) {
    return drum && Number.isFinite(drum.s) && drum.s >= 0 && drum.s <= 1000000 &&
      ["kick", "snare", "hat", "crash"].indexOf(drum.kind) >= 0;
  }

  function validPad(part) {
    return part && Number.isFinite(part.s) && Number.isFinite(part.d) && part.s >= 0 && part.d > 0 &&
      Array.isArray(part.chord) && part.chord.length > 0 && part.chord.length <= 8 &&
      part.chord.every(function (pitch) { return Number.isFinite(pitch) && pitch >= 0 && pitch <= 127; });
  }

  function validPattern(pattern) {
    return pattern && ["kick", "snare", "hat"].every(function (kind) {
      return Array.isArray(pattern[kind]) && pattern[kind].every(function (step) {
        return Number.isFinite(step) && step >= 0 && step <= 15;
      });
    });
  }

  function validPartMix(mix) {
    if (!mix || typeof mix !== "object") return false;
    var melodic = ["melody", "chord", "bass"].every(function (part) {
      return mix[part] && typeof mix[part].instrument === "string" && mix[part].instrument.length <= 40 &&
        typeof mix[part].enabled === "boolean";
    });
    return melodic && mix.drum && typeof mix.drum.kit === "string" && mix.drum.kit.length <= 40 &&
      typeof mix.drum.enabled === "boolean";
  }

  function validVocalSettings(settings) {
    return settings && Number.isFinite(settings.leadSteps) &&
      [0, 8, 16].indexOf(settings.leadSteps) >= 0 &&
      Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 150;
  }

  function validExtraTrack(track) {
    return track && typeof track.id === "string" && track.id.length <= 60 &&
      typeof track.name === "string" && track.name.length <= 80 &&
      Number.isFinite(track.program) && track.program >= 0 && track.program <= 127 &&
      Array.isArray(track.notes) && track.notes.every(validNote);
  }

  function validImportedTrack(track) {
    return track && typeof track.id === "string" && track.id.length <= 80 &&
      typeof track.name === "string" && track.name.length <= 120 &&
      Number.isFinite(track.channel) && track.channel >= 0 && track.channel <= 15 &&
      Number.isFinite(track.program) && track.program >= 0 && track.program <= 127 &&
      Number.isFinite(track.bank) && track.bank >= 0 && track.bank <= 16383 &&
      typeof track.isDrum === "boolean" &&
      ["melody", "bass", "drum", "accompaniment"].indexOf(track.role) >= 0 &&
      Array.isArray(track.notes) && track.notes.every(validNote);
  }

  function validate(state) {
    if (!state || typeof state !== "object") throw new Error("プロジェクトの中身がありません");
    if (typeof state.lyrics !== "string" || state.lyrics.length > 100000) throw new Error("歌詞の形式が正しくありません");
    if (!state.song || !Array.isArray(state.song.melody) || !state.song.melody.every(validNote)) {
      throw new Error("メロディの形式が正しくありません");
    }
    if (!Number.isFinite(state.song.bars) || state.song.bars <= 0 || state.song.bars > 10000) {
      throw new Error("小節数の形式が正しくありません");
    }
    if (!Array.isArray(state.song.bass) || !state.song.bass.every(validNote) ||
        !Array.isArray(state.song.pad) || !state.song.pad.every(validPad)) {
      throw new Error("伴奏の形式が正しくありません");
    }
    if (!Array.isArray(state.song.chords) || (!state.song.importedMidi && !state.song.chords.length) || !state.song.chords.every(validChord) ||
        !state.song.key || !Number.isFinite(state.song.key.root) || state.song.key.root < 0 || state.song.key.root > 11 ||
        ["major", "minor"].indexOf(state.song.key.mode) < 0) {
      throw new Error("コード情報が正しくありません");
    }
    if (!Array.isArray(state.song.drum) || !state.song.drum.every(validDrum)) {
      throw new Error("リズム情報が正しくありません");
    }
    if (state.song.extraTracks !== undefined &&
        (!Array.isArray(state.song.extraTracks) || !state.song.extraTracks.every(validExtraTrack))) {
      throw new Error("追加楽器トラックの形式が正しくありません");
    }
    if (state.song.importedMidi &&
        (!Array.isArray(state.song.importedTracks) || !state.song.importedTracks.length ||
         !state.song.importedTracks.every(validImportedTrack) || typeof state.song.melodyTrackId !== "string")) {
      throw new Error("読み込んだMIDIトラックの形式が正しくありません");
    }
    if (state.customDrum !== null && state.customDrum !== undefined && !validPattern(state.customDrum)) {
      throw new Error("ドラムパターンが正しくありません");
    }
    if (state.partMix !== null && state.partMix !== undefined && !validPartMix(state.partMix)) {
      throw new Error("楽器編成が正しくありません");
    }
    if (state.vocalSettings !== null && state.vocalSettings !== undefined && !validVocalSettings(state.vocalSettings)) {
      throw new Error("歌声の同期設定が正しくありません");
    }
    return state;
  }

  function encode(state) {
    validate(state);
    return JSON.stringify({ format: FORMAT, version: VERSION, state: state }, null, 2);
  }

  function decode(text) {
    var data;
    try { data = JSON.parse(text); }
    catch (error) { throw new Error("JSONファイルを読めませんでした"); }
    if (!data || data.format !== FORMAT) throw new Error("うた原稿のプロジェクトではありません");
    if (data.version !== VERSION) throw new Error("このバージョンでは開けないプロジェクトです");
    return validate(data.state);
  }

  root.project = { FORMAT: FORMAT, VERSION: VERSION, validate: validate, encode: encode, decode: decode };
})(typeof window !== "undefined" ? (window.UG = window.UG || {}) : (module.exports = {}));
