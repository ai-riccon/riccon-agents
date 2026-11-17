import test from "node:test";
import assert from "node:assert/strict";
import { isMaskingShellCommand, shellSegments } from "../scripts/lib/shell.mjs";

test("shellSegments splits unquoted separators and keeps the separator", () => {
  assert.deepEqual(
    shellSegments("npm test && echo ok || exit 1").map((segment) => [
      segment.separator,
      segment.text,
    ]),
    [
      ["start", "npm test"],
      ["&&", "echo ok"],
      ["||", "exit 1"],
    ],
  );
  assert.deepEqual(
    shellSegments(`node -e "console.log('a || echo b')"`).map(
      (segment) => segment.text,
    ),
    [`node -e "console.log('a || echo b')"`],
  );
});

test("masking commands after pipe, fallback, semicolon and shell keywords are rejected", () => {
  for (const command of [
    "npm test | echo",
    "npm test || echo ok",
    "npm test ; true",
    "npm test || /bin/true",
    "npm test | tee log",
    "npm test; exit 0",
    "echo npm test",
    "for i in 1 2; do npm test || true; done",
    "npm test || env echo ok",
    "npm test | cat",
    "npm test | grep ok",
    "npm test |& cat",
    "npm test || npm run fallback",
    "if npm test; then echo ok; fi",
    "npm test || (exit 0)",
    "sudo true",
    "node --version &",
    "node --version & wait",
  ]) {
    assert.equal(isMaskingShellCommand(command), true, command);
  }
});

test("failure-propagating and quoted commands are not rejected", () => {
  for (const command of [
    "npm test",
    "npm test && echo ok",
    "npm test || exit 1",
    "npm test || exit 2",
    "node -e \"console.log('a || echo b')\"",
    "for i in 1 2; do npm test || exit 1; done",
    "mvn -q test",
    "python3 -m unittest discover -s tests -v",
    'bash -lc "cd backend && mvn -q test"',
  ]) {
    assert.equal(isMaskingShellCommand(command), false, command);
  }
});
