import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, initProject, runJson, tempDir } from "./helpers.mjs";

test("upgrade keeps a project with managed team block in sync", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const agents = join(dir, "AGENTS.md");
  const before = readFileSync(agents, "utf8");
  assert.match(before, /<!-- riccon:team:start -->/);
  assert.match(before, /docs\/COLLABORATION\.md/);
  assert.match(before, /## 硬规则/);

  writeFileSync(agents, before.replace("## 硬规则", "## 旧规则"), "utf8");
  const result = runJson(["upgrade", "--write", "--project", dir]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.mode, "replace");
  const after = readFileSync(agents, "utf8");
  assert.match(after, /## 硬规则/);
  assert.doesNotMatch(after, /## 旧规则/);
});

test("upgrade can adopt a legacy collaboration section without losing it", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const agents = join(dir, "AGENTS.md");
  const original = readFileSync(agents, "utf8").replace(
    /<!-- riccon:team:start -->[\s\S]*?<!-- riccon:team:end -->/,
    "## 协作约定\n\n- 项目特有规则：本项目按墙钟记录成本。\n",
  );
  writeFileSync(agents, original, "utf8");
  rmSync(join(dir, "docs", "COLLABORATION.md"));

  const result = runJson([
    "upgrade",
    "--adopt-legacy",
    "--write",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.json.mode, "adopt-legacy");
  assert.equal(result.json.docs[0].action, "create");

  const after = readFileSync(agents, "utf8");
  assert.match(after, /<!-- riccon:team:start -->/);
  assert.match(after, /## 项目补充/);
  assert.match(after, /项目特有规则/);
  assert.equal(
    readFileSync(join(dir, "docs", "COLLABORATION.md"), "utf8").length > 0,
    true,
  );
});

test("upgrade refuses to rewrite an unknown AGENTS layout", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);

  const agents = join(dir, "AGENTS.md");
  writeFileSync(
    agents,
    readFileSync(agents, "utf8").replace(
      /<!-- riccon:team:start -->[\s\S]*?<!-- riccon:team:end -->/,
      "## 自定义说明\n\n项目自己的内容。\n",
    ),
    "utf8",
  );

  const result = runJson(["upgrade", "--write", "--project", dir]);
  assert.equal(result.code, 1);
  assert.equal(result.json.mode, "manual");
  assert.match(result.json.message, /no managed team block/);
});
