import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSlashArgumentContext, applySlashArgumentCompletion, querySlashArgumentCompletions,
} from "./slash-argument-completion.ts";

test("generic progression: Issue id and action are a single replacement prefix", () => {
  const text = "/issue #123 c";
  const ctx = parseSlashArgumentContext(text, text.length);
  assert.deepEqual(ctx, { name: "issue", prefix: "#123 c", argumentStart: 7, cursor: 13 });
  assert.deepEqual(applySlashArgumentCompletion(text, ctx, "#123 continue"), {
    text: "/issue #123 continue", cursor: 20,
  });
});

test("supports arbitrary levels, trailing spaces, and middle-of-input editing", () => {
  const text = "/track checkpoint pu";
  const ctx = parseSlashArgumentContext(text, text.length);
  assert.equal(ctx?.prefix, "checkpoint pu");
  assert.equal(applySlashArgumentCompletion(text, ctx, "checkpoint push").text, "/track checkpoint push");
  const middle = parseSlashArgumentContext("/track run rest", 10);
  assert.deepEqual(applySlashArgumentCompletion("/track run rest", middle, "runtime "), {
    text: "/track runtime  rest", cursor: 15,
  });
});

test("no argument suggestions for bare commands or multiline prompts", () => {
  for (const text of ["/", "/issue", "hello /issue ", "/issue\n more", "/ issue "]) {
    assert.equal(parseSlashArgumentContext(text, text.length), null, text);
  }
  assert.equal(parseSlashArgumentContext("/issue ", 7)?.prefix, "");
  assert.equal(parseSlashArgumentContext("/issue #123 ", 12)?.prefix, "#123 ");
  assert.equal(parseSlashArgumentContext("/issue #", 8)?.prefix, "#");
});

test("async Pi callback is called verbatim, optional/malformed responses are ignored", async () => {
  let observed = "";
  const command = { async getArgumentCompletions(prefix) {
    observed = prefix;
    return [{ value: "#123 continue", label: "continue", description: "Continue issue" }];
  }};
  assert.deepEqual(await querySlashArgumentCompletions(command, "#123 c"), [
    { value: "#123 continue", label: "continue", description: "Continue issue" },
  ]);
  assert.equal(observed, "#123 c");
  assert.deepEqual(await querySlashArgumentCompletions(null, "x"), []);
  assert.deepEqual(await querySlashArgumentCompletions({ getArgumentCompletions: () => null }, ""), []);
  assert.deepEqual(await querySlashArgumentCompletions({ getArgumentCompletions: () => [null, {}, { value: "ok", label: "OK" }] }, ""), [
    { value: "ok", label: "OK" },
  ]);
  assert.deepEqual(await querySlashArgumentCompletions(command, "x".repeat(4097)), []);
});
