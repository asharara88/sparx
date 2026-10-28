import { test } from "node:test";
import assert from "node:assert/strict";
import { pickVoice } from "./voice.ts";

const iphone = [
  { name: "Daniel", lang: "en-GB", localService: true },
  { name: "Samantha", lang: "en-US", localService: true },
  { name: "Arthur (Enhanced)", lang: "en-GB", localService: true },
  { name: "Maged", lang: "ar-SA", localService: true },
  { name: "Yuri", lang: "ru-RU", localService: true },
  { name: "Milena (Enhanced)", lang: "ru-RU", localService: true },
];
const android = [
  { name: "Google UK English Male", lang: "en-GB" },
  { name: "Google UK English Female", lang: "en-GB" },
  { name: "Google العربية", lang: "ar" },
  { name: "Google русский", lang: "ru-RU" },
];

test("a named female voice beats a male one, even an enhanced one", () => {
  assert.equal(pickVoice(iphone, "en-GB")?.name, "Samantha");
  assert.equal(pickVoice(iphone, "ru-RU")?.name, "Milena (Enhanced)");
  assert.equal(pickVoice(android, "en-GB")?.name, "Google UK English Female");
});

test("with only a male voice in the language, it still speaks", () => {
  assert.equal(pickVoice(iphone, "ar-EG")?.name, "Maged");
});

test("an unnamed voice in the language beats nothing", () => {
  assert.equal(pickVoice(android, "ar-EG")?.name, "Google العربية");
  assert.equal(pickVoice(android, "ru-RU")?.name, "Google русский");
});

test("no voice in the language: null, so the phone picks", () => {
  assert.equal(pickVoice(iphone, "fr-FR"), null);
  assert.equal(pickVoice([], "en-GB"), null);
});

test("a 'female' variant of a male name counts as female", () => {
  assert.equal(pickVoice([{ name: "Shakir", lang: "ar-AE" }, { name: "Shakir-Female", lang: "ar-AE" }], "ar-EG")?.name, "Shakir-Female");
});
