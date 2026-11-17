import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addModuleAndTask,
  cleanup,
  initProject,
  mutateContract,
  run,
  runJson,
  setModuleStartedHoursAgo,
  tempDir,
  writeDecision,
  writeReview,
} from "./helpers.mjs";

function prepareModule(dir) {
  const { task } = addModuleAndTask(dir);
  for (const status of ["ready", "in_progress"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  assert.equal(
    run([
      "evidence",
      "run",
      "--task",
      task.id,
      "--project",
      dir,
      "--",
      "node -e \"console.log('ok')\"",
    ]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  for (const status of ["building", "verifying", "review_pending"]) {
    const result = run([
      "module",
      "update",
      "M01",
      "--status",
      status,
      "--project",
      dir,
    ]);
    assert.equal(result.code, 0, result.stderr);
  }
  return { task };
}

test("gate fails without a review and passes with one", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.equal(fail.json.ok, false);
  assert.match(fail.json.errors.join(" "), /no review found/);

  writeReview(dir);
  const pass = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(pass.code, 0, pass.json?.errors?.join("; "));
  assert.equal(pass.json.ok, true);
  assert.equal(pass.json.review_path, ".riccon/reviews/M01-review.md");

  const status = runJson(["status", "--project", dir]);
  assert.equal(status.json.gate.status, "pass");
});

test("gate fails on an open P0", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir, {
    findings: [
      { id: "F-001", severity: "P0", title: "Data loss", status: "open" },
    ],
  });

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(" "), /P0 finding F-001/);
});

test("gate fails when a DoD item is false", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir, { dod: { tests: false } });

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(" "), /DoD tests/);
});

const STRICT_EVIDENCE_COMMAND = `node -e "console.log('ok')"`;

function initStrictProject(dir) {
  assert.equal(initProject(dir, ["--evidence-binding", "strict"]).code, 0);
  mutateContract(dir, (contract) => {
    for (const key of ["build", "test", "test_e2e", "coverage"]) {
      contract.commands[key] = STRICT_EVIDENCE_COMMAND;
    }
  });
}

function strictDodEvidence(overrides = {}) {
  return {
    acceptance: "EV-0001",
    build: "EV-0001",
    tests: "EV-0001",
    coverage: "EV-0001",
    e2e: "EV-0001",
    docs: "EV-0001",
    ...overrides,
  };
}

test("strict evidence binding requires dod_evidence for each claimed item", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  prepareModule(dir);
  writeReview(dir);

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(
    fail.json.errors.join(" "),
    /DoD acceptance is true but review has no dod_evidence\.acceptance/,
  );
});

test("strict evidence binding accepts evidence that matches the contract command", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  prepareModule(dir);
  writeReview(dir, { dodEvidence: strictDodEvidence() });

  const pass = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(pass.code, 0, pass.json.errors.join("; "));
  assert.ok(
    pass.json.checks.some(
      (check) =>
        check.id === "dod-evidence:tests" && check.status === "pass",
    ),
  );
});

test("strict evidence binding rejects mismatched or placeholder commands", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  mutateContract(dir, (contract) => {
    contract.commands.test = `node -e "console.log('different')"`;
    contract.commands.test_e2e = "not-implemented";
  });
  prepareModule(dir);
  writeReview(dir, { dodEvidence: strictDodEvidence() });

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  const errors = fail.json.errors.join(" ");
  assert.match(errors, /DoD tests evidence is invalid.*does not match commands\.test/);
  assert.match(errors, /DoD e2e requires a real commands\.test_e2e; got placeholder "not-implemented"/);
});

test("strict evidence binding rejects no-op or failure-masking evidence for any DoD key", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  mutateContract(dir, (contract) => {
    contract.commands.test = "node --version";
  });
  prepareModule(dir);
  const masked = runJson([
    "evidence",
    "run",
    "--task",
    "TASK-0001",
    "--project",
    dir,
    "--",
    "node --version || true",
  ]);
  assert.equal(masked.code, 0, masked.stderr);
  writeReview(dir, {
    dodEvidence: strictDodEvidence({ tests: masked.json.evidence.id }),
  });

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(" "), /command is a placeholder or no-op/);
});

test("strict evidence binding rejects pipe and fallback echo masking", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  mutateContract(dir, (contract) => {
    contract.commands.test = "node --version";
  });
  prepareModule(dir);

  for (const command of [
    "node --version | echo",
    "node --version | sort",
    "node --version || echo ok",
    "node --version || (true)",
    "node --version ; echo ok",
    "node --version &",
  ]) {
    const evidence = runJson([
      "evidence",
      "run",
      "--task",
      "TASK-0001",
      "--project",
      dir,
      "--",
      command,
    ]);
    assert.equal(evidence.code, 0, evidence.stderr);
    writeReview(dir, {
      dodEvidence: strictDodEvidence({ tests: evidence.json.evidence.id }),
    });
    const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
    assert.equal(fail.code, 1, `${command} should not pass`);
    assert.match(
      fail.json.errors.join(" "),
      /command is a placeholder or no-op/,
    );
  }
});

test("strict evidence binding rejects manual evidence", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  initStrictProject(dir);
  prepareModule(dir);
  const manualLog = join(dir, "manual.log");
  writeFileSync(manualLog, "manual check\n");
  assert.equal(
    run([
      "evidence",
      "add",
      "--task",
      "TASK-0001",
      "--command",
      "manual check",
      "--output",
      manualLog,
      "--project",
      dir,
    ]).code,
    0,
  );
  writeReview(dir, {
    dodEvidence: strictDodEvidence({ acceptance: "EV-0002" }),
  });

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(" "), /EV-0002 is manual/);
});

test("strict binding fails evidence recorded from a dirty working tree", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  initStrictProject(dir);
  git("add", "-A");
  git("commit", "-qm", "init");
  prepareModule(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "dirty.js"), "console.log('dirty');\n");
  const evidence = runJson([
    "evidence",
    "run",
    "--task",
    "TASK-0001",
    "--project",
    dir,
    "--",
    "node -e \"console.log('dirty evidence')\"",
  ]);
  assert.equal(evidence.code, 0, evidence.stderr);
  writeReview(dir, {
    dodEvidence: strictDodEvidence({ acceptance: evidence.json.evidence.id }),
  });

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(
    fail.json.errors.join(" "),
    /recorded from a dirty working tree/,
  );
});

test("legacy evidence binding passes with a warning when dod_evidence is absent", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir);

  const pass = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(pass.code, 0, pass.json.errors.join("; "));
  assert.ok(
    pass.json.warnings.some((warning) =>
      /quality\.evidence_binding is legacy/.test(warning),
    ),
  );
});

test("gate fails on an open blocking decision", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir);
  writeDecision(dir, { blocking: true, status: "open" });

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(" "), /blocking decision/);

  writeDecision(dir, { blocking: true, status: "answered" });
  const pass = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(pass.code, 0, pass.json.errors.join("; "));
});

test("gate fails when the wall-clock limit is exceeded unless allowed", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir);
  setModuleStartedHoursAgo(dir, "M01", 9);

  const fail = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(fail.code, 1);
  assert.match(fail.json.errors.join(" "), /wall-clock/);

  const pass = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--allow-overrun",
    "--project",
    dir,
  ]);
  assert.equal(pass.code, 0, pass.json.errors.join("; "));
  assert.ok(pass.json.warnings.some((warning) => /wall-clock/.test(warning)));
});

test("module done refuses without a review, then succeeds", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);

  const fail = run([
    "module",
    "update",
    "M01",
    "--status",
    "done",
    "--project",
    dir,
  ]);
  assert.equal(fail.code, 1);
  assert.match(fail.stderr, /gate failed/);

  writeReview(dir);
  const pass = run([
    "module",
    "update",
    "M01",
    "--status",
    "done",
    "--project",
    dir,
  ]);
  assert.equal(pass.code, 0, pass.stderr);

  const status = runJson(["status", "--project", dir]);
  assert.equal(status.json.phase, "release");
  assert.equal(status.json.current_module, null);
  assert.equal(status.json.gate.status, "pass");
});

test("gate on a planned module fails", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  addModuleAndTask(dir);

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(" "), /still planned/);
});

test("gate rejects a review bound to another module", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir, { dataModuleId: "M02" });

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(" "), /review module_id M02/);
});

test("gate rejects a stale review and missing reviewed evidence", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);

  writeReview(dir, { reviewedEvidence: [] });
  const missing = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(missing.code, 1);
  assert.match(
    missing.json.errors.join(" "),
    /does not list reviewed_evidence/,
  );

  writeReview(dir, { createdAt: "2020-01-01T00:00:00.000Z" });
  const stale = runJson(["gate", "check", "--module", "M01", "--project", dir]);
  assert.equal(stale.code, 1);
  assert.match(stale.json.errors.join(" "), /review predates evidence/);
});

test("gate allows the verifier role to review its own verification task", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = prepareModule(dir);
  assert.equal(
    run([
      "task",
      "update",
      task.id,
      "--owner",
      "riccon/verifier",
      "--project",
      dir,
    ]).code,
    0,
  );
  writeReview(dir, { reviewerAgent: "riccon/verifier" });

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 0, result.json?.errors?.join("; "));
});

test("gate --require-scope catches post-done working tree changes", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");

  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  assert.equal(
    run([
      "evidence",
      "run",
      "--task",
      task.id,
      "--project",
      dir,
      "--",
      "node -e \"console.log('ok')\"",
    ]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  for (const status of ["building", "verifying", "review_pending"]) {
    assert.equal(
      run(["module", "update", "M01", "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  writeReview(dir);
  assert.equal(
    runJson(["gate", "check", "--module", "M01", "--project", dir]).code,
    0,
  );

  writeFileSync(join(dir, "docs", "outside.md"), "outside\n");
  const normal = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(normal.code, 0, normal.json?.errors?.join("; "));

  const strict = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--require-scope",
    "--project",
    dir,
  ]);
  assert.equal(strict.code, 1);
  assert.match(
    strict.json.errors.join(" "),
    /working tree has uncommitted changes/,
  );
});

test("gate --require-scope rejects an invalid end_commit", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");

  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  assert.equal(
    run([
      "evidence",
      "run",
      "--task",
      task.id,
      "--project",
      dir,
      "--",
      "node -e \"console.log('ok')\"",
    ]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  for (const status of ["building", "verifying", "review_pending"]) {
    assert.equal(
      run(["module", "update", "M01", "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  writeReview(dir);

  const taskFile = join(dir, ".riccon", "tasks", `${task.id}.json`);
  const data = JSON.parse(readFileSync(taskFile, "utf8"));
  data.end_commit = "f".repeat(40);
  writeFileSync(taskFile, `${JSON.stringify(data, null, 2)}\n`);

  const strict = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--require-scope",
    "--project",
    dir,
  ]);
  assert.equal(strict.code, 1);
  assert.match(strict.json.errors.join(" "), /end_commit .* does not exist/);
});

test("gate --require-scope rejects an end_commit before its baseline", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir }).toString().trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");

  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }
  assert.equal(
    run([
      "evidence",
      "run",
      "--task",
      task.id,
      "--project",
      dir,
      "--",
      "node -e \"console.log('ok')\"",
    ]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }

  writeFileSync(join(dir, "docs", "after.md"), "after\n");
  git("add", "-A");
  git("commit", "-qm", "after task end");
  const after = git("rev-parse", "HEAD");

  const taskFile = join(dir, ".riccon", "tasks", `${task.id}.json`);
  const data = JSON.parse(readFileSync(taskFile, "utf8"));
  const end = data.end_commit;
  data.baseline_commit = after;
  data.end_commit = end;
  writeFileSync(taskFile, `${JSON.stringify(data, null, 2)}\n`);

  const strict = runJson(["gate", "check", "--module", "M01", "--require-scope", "--project", dir]);
  assert.equal(strict.code, 1);
  assert.match(
    `${strict.stdout}\n${strict.stderr}\n${strict.json?.errors?.join(" ") || ""}`,
    /end_commit .* is not a descendant of baseline/,
  );
});

test("gate --require-scope rejects committed changes after a task end_commit", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");

  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  assert.equal(
    run([
      "evidence",
      "run",
      "--task",
      task.id,
      "--project",
      dir,
      "--",
      "node -e \"console.log('ok')\"",
    ]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(
      run(["task", "update", task.id, "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  for (const status of ["building", "verifying", "review_pending"]) {
    assert.equal(
      run(["module", "update", "M01", "--status", status, "--project", dir])
        .code,
      0,
    );
  }
  writeReview(dir);

  writeFileSync(join(dir, "docs", "outside.md"), "outside\n");
  git("add", "-A");
  git("commit", "-qm", "post-end out of scope change");

  const strict = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--require-scope",
    "--project",
    dir,
  ]);
  assert.equal(strict.code, 1);
  assert.match(
    strict.json.errors.join(" "),
    /changed after task .* end_commit .* is outside every task write_scope/,
  );
});

test("gate --require-scope rejects post-end changes when no task declares a write_scope", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync('git', args, { cwd: dir });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-qm', 'init');

  assert.equal(initProject(dir).code, 0);
  const module = runJson(['module', 'new', '--title', 'MVC', '--kind', 'mvc', '--project', dir]);
  assert.equal(module.code, 0, module.stderr);
  const created = runJson([
    'task',
    'new',
    '--module',
    module.json.module.id,
    '--title',
    'Verification only',
    '--owner',
    'riccon/verifier',
    '--acceptance',
    'Review only',
    '--project',
    dir,
  ]);
  assert.equal(created.code, 0, created.stderr);
  const task = created.json.task;
  assert.deepEqual(task.write_scope, []);
  git('add', '-A');
  git('commit', '-qm', 'baseline');
  for (const status of ['ready', 'in_progress']) {
    assert.equal(run(['task', 'update', task.id, '--status', status, '--project', dir]).code, 0);
  }
  assert.equal(
    run([
      'evidence',
      'run',
      '--task',
      task.id,
      '--project',
      dir,
      '--',
      'node -e "console.log(\'ok\')"',
    ]).code,
    0,
  );
  for (const status of ['review', 'done']) {
    assert.equal(run(['task', 'update', task.id, '--status', status, '--project', dir]).code, 0);
  }
  for (const status of ['building', 'verifying', 'review_pending']) {
    assert.equal(run(['module', 'update', 'M01', '--status', status, '--project', dir]).code, 0);
  }
  writeReview(dir);

  writeFileSync(join(dir, 'docs', 'outside.md'), 'outside\n');
  git('add', '-A');
  git('commit', '-qm', 'post-end change with no declared scope');

  const strict = runJson(['gate', 'check', '--module', 'M01', '--require-scope', '--project', dir]);
  assert.equal(strict.code, 1);
  assert.match(
    strict.json.errors.join(' '),
    /changed after task .* end_commit .* is outside every task write_scope/,
  );
});

test("gate --require-scope rejects a done task without end_commit", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }
  assert.equal(
    run(["evidence", "run", "--task", task.id, "--project", dir, "--", "node -e \"console.log('ok')\""]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }
  const taskFile = join(dir, ".riccon", "tasks", `${task.id}.json`);
  const data = JSON.parse(readFileSync(taskFile, "utf8"));
  data.end_commit = null;
  writeFileSync(taskFile, `${JSON.stringify(data, null, 2)}\n`);
  const strict = runJson(["gate", "check", "--module", "M01", "--require-scope", "--project", dir]);
  assert.equal(strict.code, 1);
  assert.match(`${strict.stdout}\n${strict.stderr}\n${strict.json?.errors?.join(" ") || ""}`, /done without end_commit/);
});

test("gate --require-scope rejects an end_commit that is not an ancestor of HEAD", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  const git = (...args) => execFileSync("git", args, { cwd: dir }).toString().trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("commit", "--allow-empty", "-qm", "init");
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  git("add", "-A");
  git("commit", "-qm", "baseline");
  for (const status of ["ready", "in_progress"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }
  assert.equal(
    run(["evidence", "run", "--task", task.id, "--project", dir, "--", "node -e \"console.log('ok')\""]).code,
    0,
  );
  for (const status of ["review", "done"]) {
    assert.equal(run(["task", "update", task.id, "--status", status, "--project", dir]).code, 0);
  }
  git("add", "-A");
  git("commit", "-qm", "task state done");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("checkout", "-qb", "other");
  writeFileSync(join(dir, "other.txt"), "other\n");
  git("add", "-A");
  git("commit", "-qm", "other branch");
  const other = git("rev-parse", "HEAD");
  git("checkout", "-q", branch);
  const taskFile = join(dir, ".riccon", "tasks", `${task.id}.json`);
  const data = JSON.parse(readFileSync(taskFile, "utf8"));
  data.end_commit = other;
  writeFileSync(taskFile, `${JSON.stringify(data, null, 2)}\n`);
  const strict = runJson(["gate", "check", "--module", "M01", "--require-scope", "--project", dir]);
  assert.equal(strict.code, 1);
  assert.match(`${strict.stdout}\n${strict.stderr}\n${strict.json?.errors?.join(" ") || ""}`, /is not an ancestor of HEAD/);
});

test("gate --require-scope rejects commit fields in a non-git project", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  const { task } = addModuleAndTask(dir);
  const taskFile = join(dir, ".riccon", "tasks", `${task.id}.json`);
  const data = JSON.parse(readFileSync(taskFile, "utf8"));
  data.baseline_commit = "a".repeat(40);
  data.end_commit = "b".repeat(40);
  writeFileSync(taskFile, `${JSON.stringify(data, null, 2)}\n`);
  const strict = runJson(["gate", "check", "--module", "M01", "--require-scope", "--project", dir]);
  assert.equal(strict.code, 1);
  assert.match(`${strict.stdout}\n${strict.stderr}\n${strict.json?.errors?.join(" ") || ""}`, /not a git repository/);
});

test("gate --require-scope fails when a task has no baseline", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir);

  const normal = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(normal.code, 0, normal.json?.errors?.join("; "));
  assert.ok(
    normal.json.warnings.some((warning) =>
      /write_scope was not verified/.test(warning),
    ),
  );

  const strict = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--require-scope",
    "--project",
    dir,
  ]);
  assert.equal(strict.code, 1);
  assert.match(strict.json.errors.join(" "), /write_scope was not verified/);
});

test("gate rejects a reviewer that owns a task in the module", (t) => {
  const dir = tempDir();
  t.after(() => cleanup(dir));
  assert.equal(initProject(dir).code, 0);
  prepareModule(dir);
  writeReview(dir, { reviewerAgent: "riccon/builder" });

  const result = runJson([
    "gate",
    "check",
    "--module",
    "M01",
    "--project",
    dir,
  ]);
  assert.equal(result.code, 1);
  assert.match(result.json.errors.join(" "), /owns a task/);
});
