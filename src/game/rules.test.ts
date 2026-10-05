import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { evaluateGuess, guesserPoints, hintSchedule, levenshtein, maskWord, normalize } from "./rules.js";

describe("normalize", () => {
  test("ignores case, accents, punctuation and spacing", () => {
    assert.equal(normalize("  Ice-Cream! "), "icecream");
    assert.equal(normalize("Crème Brûlée"), "cremebrulee");
  });
});

describe("evaluateGuess", () => {
  test("accepts exact and loosely formatted answers", () => {
    assert.equal(evaluateGuess("banana", "banana"), "correct");
    assert.equal(evaluateGuess("ICECREAM", "ice cream"), "correct");
  });

  test("flags a one-letter miss on longer words as close", () => {
    assert.equal(evaluateGuess("bananna", "banana"), "close");
    assert.equal(evaluateGuess("bananq", "banana"), "close");
  });

  test("never flags short words as close", () => {
    assert.equal(evaluateGuess("bat", "cat"), "wrong");
  });

  test("rejects empty and unrelated guesses", () => {
    assert.equal(evaluateGuess("!!!", "cat"), "wrong");
    assert.equal(evaluateGuess("rocket", "banana"), "wrong");
  });
});

describe("levenshtein", () => {
  test("counts edits", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("same", "same"), 0);
  });
});

describe("guesserPoints", () => {
  test("scales from 300 at the start to 50 at the buzzer", () => {
    assert.equal(guesserPoints(80_000, 80_000), 300);
    assert.equal(guesserPoints(40_000, 80_000), 175);
    assert.equal(guesserPoints(0, 80_000), 50);
  });

  test("clamps out-of-range input", () => {
    assert.equal(guesserPoints(-5_000, 80_000), 50);
    assert.equal(guesserPoints(99_000, 80_000), 300);
    assert.equal(guesserPoints(10, 0), 50);
  });
});

describe("hintSchedule", () => {
  test("reveals at most a third of the letters, never spaces, in the second half", () => {
    const word = "traffic light";
    const reveals = hintSchedule(word, 80_000);
    assert.equal(reveals.length, 3);
    for (const { atMs, index } of reveals) {
      assert.notEqual(word[index], " ");
      assert.ok(atMs >= 40_000 && atMs < 80_000);
    }
    assert.equal(new Set(reveals.map((r) => r.index)).size, reveals.length);
  });

  test("gives no hints for tiny words", () => {
    assert.equal(hintSchedule("ox", 80_000).length, 0);
  });
});

describe("maskWord", () => {
  test("shows spaces and revealed letters only", () => {
    assert.deepEqual(maskWord("hot dog", new Set([4])), [null, null, null, " ", "d", null, null]);
  });
});
