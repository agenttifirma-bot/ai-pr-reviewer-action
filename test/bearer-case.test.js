import assert from "node:assert/strict";
import test from "node:test";
import { redact } from "../src/redact.js";

const T20 = "abcdefghijklmnopqrst";
const T19 = "abcdefghijklmnopqrs";

for (const word of ["Bearer", "bearer", "BEARER", "bEaReR"]) {
  test(`redacts ${word} with a 20 character token`, () => {
    const r = redact(`authorization: ${word} ${T20}`);
    assert.equal(r.text, "authorization: Bearer [REDACTED]");
    assert.equal(r.count, 1);
  });
  test(`does not redact ${word} with a 19 character token`, () => {
    const r = redact(`authorization: ${word} ${T19}`);
    assert.equal(r.text, `authorization: ${word} ${T19}`);
    assert.equal(r.count, 0);
  });
}

test("the word bearer in ordinary text is unchanged", () => {
  const s = "the bearer of this letter; Bearer of bad news";
  assert.deepEqual(redact(s), { text: s, count: 0 });
});
