import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { ensureDir, exists, readText, sha256, writeText } from "./fsx.mjs";
import { parseFrontmatter, stringifyFrontmatter } from "./yamlx.mjs";
import { assertSchema, validateSchema } from "./schema.mjs";
import { checkSandbox } from "./sandbox.mjs";
import { verifyEvidenceRecord } from "./evidence.mjs";
import { nowIso } from "./time.mjs";
import { fail } from "./errors.mjs";
import {
  loadProject,
  nextId,
  readDecisions,
  readEvidence,
  readModules,
  readReleases,
  readReviews,
  readTasks,
  saveState,
} from "./project.mjs";
import { loadContract } from "./contract.mjs";
import { checkGate } from "./gate.mjs";
import { isAccepted } from "./acceptance.mjs";
import {
  findingClosureChecks,
  isRealSessionId,
  requiresRealSession,
  reviewClosureChecks,
} from "./review.mjs";

const T4_ARTIFACTS = ["threat_model", "load_test", "rollback_drill", "runbook"];
const BASE_ARTIFACTS = ["rollback_drill", "runbook"];

/** builder 实例 owner 的前缀；用于识别实现角色，防止实例 owner 绕过独立性检查。 */
function isImplementationRole(agent) {
  return (
    agent === "riccon/builder" ||
    agent === "riccon/lead" ||
    String(agent || "").startsWith("riccon/builder-")
  );
}

/**
 * 将 review findings 映射为 release 检查项。
 *
 * 保留旧导出供调用方和测试使用；新的 release/second review 使用
 * `reviewClosureChecks`，按评审创建时间启用 finding 闭环规则。
 *
 * @param {any[]} findings
 * @param {string} prefix
 * @returns {{ id: string, status: 'fail'|'warn', message: string }[]}
 */
export function reviewFindingChecks(findings, prefix = "release_finding") {
  return findingClosureChecks(findings, { prefix, enforce: false });
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * 批准时绑定发布内容，防止批准后偷换版本、范围、产物、证据或评审文件。
 *
 * 绑定范围：
 * - artifact 文件字节；
 * - 每条 EV 的 JSON 字节、命令/退出码/commit 摘要，以及日志文件字节；
 * - 绑定到该 release 的评审文件字节；
 * - 第二模型评审文件字节（若提供了路径）。
 *
 * @param {any} release
 * @param {string} projectDir
 * @param {{ secondReviewPath?: string }} [options]
 * @returns {string}
 */
export function releaseContentHash(release, projectDir, options = {}) {
  const artifactKeys = [
    "threat_model",
    "load_test",
    "rollback_drill",
    "runbook",
  ];
  const artifacts = {};
  for (const key of artifactKeys) {
    const path = release.artifacts?.[key] || "";
    const absolute = path ? resolve(projectDir, path) : null;
    artifacts[key] = {
      path,
      sha256: absolute && exists(absolute) ? fileSha256(absolute) : null,
    };
  }

  const evidenceById = new Map(
    readEvidence(projectDir).map((record) => [record.id, record]),
  );
  const evidence = (release.evidence || []).map((id) => {
    const record = evidenceById.get(id);
    if (!record) return { id, missing: true };
    const recordPath = join(
      projectDir,
      ".riccon",
      "evidence",
      record.task_id,
      `${id}.json`,
    );
    const outputPath = record.output_path
      ? resolve(projectDir, record.output_path)
      : null;
    return {
      id,
      task_id: record.task_id,
      command: record.command,
      exit_code: record.exit_code,
      commit: record.commit || null,
      dirty: Boolean(record.dirty),
      record_sha256: exists(recordPath) ? fileSha256(recordPath) : null,
      output_sha256: record.output_sha256 || null,
      output_bytes: record.output_bytes ?? null,
      log_sha256:
        outputPath && exists(outputPath) ? fileSha256(outputPath) : null,
    };
  });

  const reviews = readReviews(projectDir)
    .filter(
      (record) =>
        record.data &&
        record.data.module_id === "RELEASE" &&
        record.data.release_id === release.id,
    )
    .map((record) => ({
      path: relative(projectDir, record.file),
      sha256: fileSha256(record.file),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const secondReviewPath =
    options.secondReviewPath ||
    release.approval?.second_review?.review_path ||
    "";
  let secondReview = null;
  if (secondReviewPath) {
    const absolute = resolve(projectDir, secondReviewPath);
    secondReview = {
      path: secondReviewPath,
      sha256: exists(absolute) ? fileSha256(absolute) : null,
    };
  }

  return sha256(
    JSON.stringify({
      id: release.id,
      version: release.version,
      environment: release.environment,
      scope: release.scope,
      risk_tier: release.risk_tier,
      artifacts,
      evidence,
      reviews,
      second_review: secondReview,
    }),
  );
}

/**
 * 读取并校验 production/staging 的第二模型评审文件。
 *
 * @param {string} projectDir
 * @param {any} release
 * @param {string} reviewPath
 * @param {string} expectedModel
 * @returns {{ errors: string[], review: any | null, relativePath: string | null }}
 */
function validateSecondReview(projectDir, release, reviewPath, expectedModel) {
  const errors = [];
  if (!reviewPath) {
    return {
      errors: ["second review requires --second-review-path"],
      review: null,
      relativePath: null,
    };
  }
  const absolute = resolve(projectDir, reviewPath);
  const rel = relative(projectDir, absolute);
  if (isAbsolute(rel) || rel.startsWith("..")) {
    return {
      errors: [`second review path escapes the project: ${reviewPath}`],
      review: null,
      relativePath: null,
    };
  }
  if (!exists(absolute)) {
    return {
      errors: [`second review not found: ${reviewPath}`],
      review: null,
      relativePath: null,
    };
  }
  const reviewText = readText(absolute);
  const parsed = parseFrontmatter(reviewText);
  if (!parsed.hasFrontmatter) {
    errors.push(`second review ${reviewPath} has no front matter`);
  }
  if (parsed.data?.review_kind !== "second") {
    errors.push("second review must declare review_kind: second");
  }
  const check = validateSchema("review.schema.json", parsed.data);
  if (!check.valid) {
    errors.push(`second review is invalid: ${check.errors.join("; ")}`);
  }
  const review = parsed.data || {};
  if (review.module_id !== "RELEASE") {
    errors.push(
      `second review module_id is ${review.module_id || "(none)"}, expected RELEASE`,
    );
  }
  if (review.release_id !== release.id) {
    errors.push(
      `second review is bound to ${review.release_id || "(none)"}, not ${release.id}`,
    );
  }
  if (review.version !== release.version) {
    errors.push(
      `second review version ${review.version || "(none)"} does not match ${release.version}`,
    );
  }
  if (review.environment !== release.environment) {
    errors.push(
      `second review environment ${review.environment || "(none)"} does not match ${release.environment}`,
    );
  }
  if (review.verdict !== "pass") {
    errors.push(
      `second review verdict is ${review.verdict || "(none)"}, expected pass`,
    );
  }
  const reviewTime = Date.parse(review.created_at || "");
  const releaseTime = Date.parse(release.created_at || "");
  if (Number.isNaN(reviewTime)) {
    errors.push("second review has no valid created_at");
  } else if (!Number.isNaN(releaseTime) && reviewTime < releaseTime) {
    errors.push("second review predates the release");
  }
  if (!review.reviewer || review.reviewer.independent !== true) {
    errors.push("second review reviewer.independent must be true");
  }
  if (
    requiresRealSession(review.created_at) &&
    !isRealSessionId(review.reviewer?.session)
  ) {
    errors.push(
      "second review reviewer.session must be a real ses_... id for reviews created on or after 2026-11-20",
    );
  }
  if (expectedModel && review.reviewer?.model !== expectedModel) {
    errors.push(
      `second review model ${review.reviewer?.model || "(none)"} does not match ${expectedModel}`,
    );
  }
  if (isImplementationRole(review.reviewer?.agent)) {
    errors.push(
      `second review reviewer ${review.reviewer.agent} cannot be the implementing role`,
    );
  }
  const reviewed = new Set(review.reviewed_evidence || []);
  const missing = (release.evidence || []).filter((id) => !reviewed.has(id));
  if (missing.length) {
    errors.push(
      `second review does not cover release evidence: ${missing.join(", ")}`,
    );
  }
  return {
    errors,
    review,
    relativePath: rel,
    reviewHash: sha256(reviewText),
  };
}

/**
 * @param {string} projectDir
 * @returns {{ file: string, data: any | null, body: string, error: string | null }[]}
 */
function releaseRecords(projectDir) {
  return readReleases(projectDir).sort((a, b) =>
    String(a.data?.id || a.file).localeCompare(String(b.data?.id || b.file)),
  );
}

/**
 * @param {{ file: string, data: any | null, body: string, error: string | null }[]} records
 * @param {{ releaseId?: string, environment?: string }} [options]
 */
function selectRelease(records, options = {}) {
  let candidates = records;
  if (options.releaseId) {
    candidates = candidates.filter(
      (record) => record.data?.id === options.releaseId,
    );
  }
  if (options.environment) {
    candidates = candidates.filter(
      (record) => record.data?.environment === options.environment,
    );
  }
  return candidates[candidates.length - 1] || null;
}

/**
 * @param {string} projectDir
 * @param {any} release
 * @param {string} decisionId
 * @returns {any}
 */
function approvalDecisionForRelease(projectDir, release, decisionId) {
  const decision = readDecisions(projectDir).find(
    (record) => record.data?.decision_id === decisionId,
  );
  if (!decision || decision.error) {
    fail(`approval decision ${decisionId} not found or invalid`, {
      code: "ERR_DECISION_NOT_FOUND",
    });
  }
  if (decision.data.status !== "answered") {
    fail(
      `approval decision ${decisionId} is ${decision.data.status}, not answered`,
      {
        code: "ERR_DECISION_STATE",
      },
    );
  }
  if (decision.data.owner !== "user") {
    fail(`approval decision ${decisionId} is not owned by user`, {
      code: "ERR_DECISION_OWNER",
    });
  }
  if (!String(decision.data.answer || "").trim()) {
    fail(`approval decision ${decisionId} has an empty answer`, {
      code: "ERR_DECISION_ANSWER",
    });
  }
  if (decision.data.answer_kind !== "approve") {
    fail(
      `approval decision ${decisionId} answer_kind is ${decision.data.answer_kind || "(missing)"}, expected approve`,
      { code: "ERR_DECISION_KIND" },
    );
  }
  if (decision.data.release_id !== release.id) {
    fail(
      `approval decision ${decisionId} is bound to ${decision.data.release_id || "(none)"}, not ${release.id}`,
      { code: "ERR_DECISION_RELEASE" },
    );
  }
  if (decision.data.environment !== release.environment) {
    fail(
      `approval decision ${decisionId} environment ${decision.data.environment || "(missing)"} does not match ${release.environment}`,
      { code: "ERR_DECISION_ENVIRONMENT" },
    );
  }
  const answeredAt = Date.parse(decision.data.answered_at || "");
  const createdAt = Date.parse(release.created_at || "");
  if (Number.isNaN(answeredAt)) {
    fail(`approval decision ${decisionId} has no valid answered_at`, {
      code: "ERR_DECISION_TIMELINE",
    });
  }
  if (!Number.isNaN(createdAt) && answeredAt < createdAt) {
    fail(
      `approval decision ${decisionId} was answered before release ${release.id} was created`,
      { code: "ERR_DECISION_TIMELINE" },
    );
  }
  return decision.data;
}

/**
 * @param {string} projectDir
 * @param {any} release
 * @returns {string[]}
 */
function approvalErrors(projectDir, release) {
  const errors = [];
  const approval = release.approval;
  if (!approval || approval.by !== "user" || !approval.decision_id) {
    return ["release has no explicit user approval"];
  }
  if (approval.release_id !== release.id) {
    errors.push(
      `release approval is bound to ${approval.release_id || "(missing)"}, not ${release.id}`,
    );
  }
  if (approval.environment !== release.environment) {
    errors.push(
      `release approval environment ${approval.environment || "(missing)"} does not match ${release.environment}`,
    );
  }
  if (approval.answer_kind !== "approve") {
    errors.push(
      `release approval answer_kind is ${approval.answer_kind || "(missing)"}, expected approve`,
    );
  }

  const decision = readDecisions(projectDir).find(
    (record) => record.data?.decision_id === approval.decision_id,
  );
  if (!decision || decision.error) {
    errors.push(
      `approval decision ${approval.decision_id} not found or invalid`,
    );
    return errors;
  }
  if (decision.data.status !== "answered") {
    errors.push(
      `approval decision ${approval.decision_id} is ${decision.data.status}, not answered`,
    );
  }
  if (decision.data.owner !== "user") {
    errors.push(
      `approval decision ${approval.decision_id} is not owned by user`,
    );
  }
  const answer = String(decision.data.answer || "").trim();
  if (!answer) {
    errors.push(
      `approval decision ${approval.decision_id} has an empty answer`,
    );
  }
  if (decision.data.answer_kind !== "approve") {
    errors.push(
      `approval decision ${approval.decision_id} answer_kind is ${decision.data.answer_kind || "(missing)"}, expected approve`,
    );
  }
  if (decision.data.release_id !== release.id) {
    errors.push(
      `approval decision ${approval.decision_id} is bound to ${decision.data.release_id || "(none)"}, not ${release.id}`,
    );
  }
  if (decision.data.environment !== release.environment) {
    errors.push(
      `approval decision ${approval.decision_id} environment ${decision.data.environment || "(missing)"} does not match ${release.environment}`,
    );
  }
  if (!approval.answer_sha256) {
    errors.push(
      `release approval has no answer_sha256; cannot bind the decision answer`,
    );
  } else if (answer && sha256(answer) !== approval.answer_sha256) {
    errors.push(
      `release approval answer_sha256 does not match decision ${approval.decision_id}`,
    );
  }
  if (!approval.release_sha256) {
    if (release.environment !== "sandbox") {
      errors.push("release approval has no release_sha256 content binding");
    }
  } else if (
    approval.release_sha256 !==
    releaseContentHash(release, projectDir, {
      secondReviewPath: approval.second_review?.review_path,
    })
  ) {
    errors.push(
      "release content changed after approval; release_sha256 does not match",
    );
  }

  const answeredAt = Date.parse(decision.data.answered_at || "");
  const approvedAt = Date.parse(approval.approved_at || "");
  const createdAt = Date.parse(release.created_at || "");
  if (Number.isNaN(answeredAt)) {
    errors.push(
      `approval decision ${approval.decision_id} has no valid answered_at`,
    );
  }
  if (Number.isNaN(approvedAt)) {
    errors.push("release approval has no valid approved_at");
  }
  if (
    !Number.isNaN(answeredAt) &&
    !Number.isNaN(createdAt) &&
    answeredAt < createdAt
  ) {
    errors.push(
      `approval decision ${approval.decision_id} was answered before release ${release.id} was created`,
    );
  }
  if (
    !Number.isNaN(answeredAt) &&
    !Number.isNaN(approvedAt) &&
    approvedAt < answeredAt
  ) {
    errors.push(
      `release approval timestamp precedes decision ${approval.decision_id} answer`,
    );
  }
  return errors;
}

/**
 * @param {string} projectDir
 * @param {{ releaseId?: string, environment?: string }} [options]
 * @returns {any}
 */
export function checkRelease(projectDir, options = {}) {
  const requireScope = options.requireScope !== false && options.legacyScope !== true;
  /** @type {{ id: string, status: 'pass'|'warn'|'fail', message: string }[]} */
  const checks = [];
  const errors = [];
  const warnings = [];

  /**
   * @param {string} id
   * @param {'pass'|'warn'|'fail'} status
   * @param {string} message
   */
  function add(id, status, message) {
    checks.push({ id, status, message });
    if (status === "fail") errors.push(message);
    if (status === "warn") warnings.push(message);
  }

  const { state } = loadProject(projectDir);
  const contractResult = loadContract(projectDir);
  if (contractResult.errors.length) {
    add(
      "contract",
      "fail",
      `project contract is invalid: ${contractResult.errors.join("; ")}`,
    );
  } else {
    add("contract", "pass", "project contract is valid");
  }
  const contract = contractResult.contract || {};
  const tier = contract.project?.risk_tier || "T3";

  if (state.phase === "release" || state.phase === "operate") {
    add("phase", "pass", `state phase is ${state.phase}`);
  } else {
    add(
      "phase",
      "fail",
      `state phase is ${state.phase}; finish modules and enter release first`,
    );
  }

  const modules = readModules(projectDir);
  if (!modules.length) {
    add("modules", "fail", "no modules found; nothing to release");
  } else {
    const unfinished = modules.filter((module) => module.status !== "done");
    if (unfinished.length) {
      add(
        "modules",
        "fail",
        `${unfinished.length} module(s) are not done: ${unfinished
          .map((module) => `${module.id}=${module.status}`)
          .join(", ")}`,
      );
    } else {
      add("modules", "pass", `all ${modules.length} module(s) are done`);
    }
    for (const module of modules) {
      const acceptance = module.product_acceptance;
      const unrecorded =
        acceptance &&
        acceptance.product_status === "not-recorded" &&
        acceptance.user_status === "not-recorded";
      if (!acceptance || unrecorded) {
        add(
          `product_acceptance:${module.id}`,
          "warn",
          `module ${module.id} has no product acceptance record (legacy/not-recorded); record Product and user acceptance before release`,
        );
      } else if (!isAccepted(module)) {
        add(
          `product_acceptance:${module.id}`,
          "fail",
          `module ${module.id} acceptance is product=${acceptance.product_status}, user=${acceptance.user_status}; release requires product=pass, user=accepted`,
        );
      } else {
        add(
          `product_acceptance:${module.id}`,
          "pass",
          `module ${module.id} has Product and user acceptance`,
        );
      }
    }
  }

  if (requireScope) {
    for (const module of modules) {
      const gate = checkGate({
        projectDir,
        moduleId: module.id,
        allowOverrun: true,
        requireScope: true,
      });
      if (gate.ok) {
        add(
          `module_gate:${module.id}`,
          "pass",
          `module ${module.id} gate passes with scope`,
        );
      } else {
        add(
          `module_gate:${module.id}`,
          "fail",
          `module ${module.id} gate failed: ${gate.errors.join("; ")}`,
        );
      }
    }
  }

  const records = releaseRecords(projectDir);
  for (const record of records) {
    if (record.error) add("release-schema", "fail", record.error);
  }
  const release = selectRelease(records, options);
  if (!release) {
    add(
      "release",
      "fail",
      options.releaseId
        ? `release ${options.releaseId} not found`
        : "no release record found in .riccon/releases/",
    );
  } else if (release.error) {
    add("release-schema", "fail", `release is invalid: ${release.error}`);
  } else {
    const data = release.data;
    add(
      "release",
      "pass",
      `release found: ${relative(projectDir, release.file)}`,
    );
    if (options.legacyScope && data.environment !== "sandbox") {
      add(
        "release_scope",
        "fail",
        "--legacy-scope is only allowed for sandbox releases",
      );
    } else if (options.legacyScope) {
      add(
        "release_scope",
        "warn",
        "legacy sandbox release: module gate/scope is not re-run",
      );
    }
    if (data.status === "approved" || data.status === "released") {
      add("release_status", "pass", `release status is ${data.status}`);
    } else {
      add(
        "release_status",
        "fail",
        `release status is ${data.status}; approval is required`,
      );
    }
    if (data.risk_tier !== tier) {
      add(
        "release_risk_tier",
        "fail",
        `release risk_tier ${data.risk_tier} does not match contract ${tier}`,
      );
    } else {
      add("release_risk_tier", "pass", `release risk_tier is ${tier}`);
    }

    const approvalProblems = approvalErrors(projectDir, data);
    if (approvalProblems.length) {
      add("release_approval", "fail", approvalProblems.join("; "));
    } else {
      add(
        "release_approval",
        "pass",
        `approval decision ${data.approval.decision_id} is answered by user and bound to ${data.id}`,
      );
      if (!data.approval.release_sha256) {
        add(
          "release_approval_content",
          "warn",
          "approval does not bind release content (legacy record); new approvals set release_sha256",
        );
      }
    }

    const requiredArtifacts = tier === "T4" ? T4_ARTIFACTS : BASE_ARTIFACTS;
    for (const key of requiredArtifacts) {
      const value = data.artifacts?.[key];
      if (!value) {
        add(
          `release_artifact:${key}`,
          "fail",
          `release artifact ${key} is missing (${tier} requires it)`,
        );
        continue;
      }
      const path = resolve(projectDir, value);
      if (!exists(path)) {
        add(
          `release_artifact:${key}`,
          "fail",
          `release artifact ${key} does not exist: ${value}`,
        );
      } else {
        add(
          `release_artifact:${key}`,
          "pass",
          `release artifact ${key}: ${value}`,
        );
      }
    }

    if (!data.evidence?.length) {
      add("release_evidence", "fail", "release has no evidence references");
    } else {
      const evidence = readEvidence(projectDir);
      const evidenceById = new Map(
        evidence.map((record) => [record.id, record]),
      );
      const tasks = readTasks(projectDir);
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      let passing = 0;
      let unbound = 0;
      for (const evidenceId of data.evidence) {
        const record = evidenceById.get(evidenceId);
        if (!record) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            `release evidence ${evidenceId} not found`,
          );
          continue;
        }
        const task = taskById.get(record.task_id);
        if (!task) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            `release evidence ${evidenceId} belongs to unknown task ${record.task_id}`,
          );
          continue;
        }
        if (!(task.evidence || []).includes(evidenceId)) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            `release evidence ${evidenceId} is not referenced by task ${task.id}`,
          );
          continue;
        }
        const verification = verifyEvidenceRecord(projectDir, record, {
          taskId: record.task_id,
          requireAncestor: true,
          requireClean: true,
          requireCommit: requireScope,
        });
        if (!verification.ok) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            verification.errors.join("; "),
          );
        } else if (record.manual === true) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            `release evidence ${evidenceId} is manual; a release requires executed runs`,
          );
        } else if (record.exit_code !== 0) {
          add(
            `release_evidence:${evidenceId}`,
            "fail",
            `release evidence ${evidenceId} exited ${record.exit_code}`,
          );
        } else {
          passing += 1;
          if (!record.commit) unbound += 1;
          add(
            `release_evidence:${evidenceId}`,
            "pass",
            `release evidence ${evidenceId} is a verified passing run`,
          );
        }
      }
      if (passing > 0) {
        add(
          "release_evidence",
          "pass",
          `${passing}/${data.evidence.length} release evidence reference(s) verified`,
        );
      }
      if (unbound > 0) {
        add(
          "release_evidence_attestation",
          "warn",
          `${unbound} release evidence record(s) have no git commit attestation (legacy)`,
        );
      }
    }

    if (tier === "T4") {
      const sandbox = checkSandbox(projectDir);
      if (sandbox.ok) {
        add("release_sandbox", "pass", "T4 sandbox check passed");
      } else {
        add(
          "release_sandbox",
          "fail",
          `T4 sandbox check failed: ${sandbox.errors.join("; ")}`,
        );
      }

      const sandboxEvidenceId = String(contract.sandbox?.evidence || "").trim();
      if (/^EV-[0-9]{4,}$/.test(sandboxEvidenceId)) {
        if ((data.evidence || []).includes(sandboxEvidenceId)) {
          add(
            "release_sandbox_evidence",
            "pass",
            `release evidence includes sandbox run ${sandboxEvidenceId}`,
          );
        } else {
          add(
            "release_sandbox_evidence",
            "fail",
            `release evidence does not include sandbox run ${sandboxEvidenceId}`,
          );
        }
      }

      if (data.environment !== "sandbox" && !data.approval?.second_review) {
        add(
          "release_second_review",
          "fail",
          "T4 staging/production releases require approval.second_review",
        );
      } else if (data.environment !== "sandbox") {
        const second = data.approval.second_review;
        const result = validateSecondReview(
          projectDir,
          data,
          second.review_path,
          second.model,
        );
        if (second.review_id && result.review?.review_id !== second.review_id) {
          result.errors.push(
            `second review id ${result.review?.review_id || "(none)"} does not match ${second.review_id}`,
          );
        }
        if (!second.review_sha256) {
          result.errors.push("second review has no review_sha256 binding");
        } else if (second.review_sha256 !== result.reviewHash) {
          result.errors.push("second review content changed after approval");
        }
        if (result.errors.length) {
          add(
            "release_second_review",
            "fail",
            `second review is not a valid bound review: ${result.errors.join("; ")}`,
          );
        } else {
          add(
            "release_second_review",
            "pass",
            `second review ${result.review.review_id} by ${result.review.reviewer.model} is bound to ${data.id}`,
          );
          for (const check of reviewClosureChecks(result.review, {
            prefix: "release_second_review_finding",
          })) {
            add(check.id, check.status, check.message);
          }
        }
      } else {
        add(
          "release_second_review",
          "warn",
          "T4 sandbox release has no second-model review (recommended for production only)",
        );
      }
    }
  }

  const reviews = readReviews(projectDir);
  const releaseReviewCandidates = reviews.filter(
    (record) =>
      record.data?.review_kind !== "second" &&
      record.data?.module_id === "RELEASE",
  );
  const releaseReview = releaseReviewCandidates
    .filter((record) => record.data?.release_id === release?.data?.id)
    .sort(
      (a, b) =>
        Date.parse(a.data?.created_at || "") -
        Date.parse(b.data?.created_at || ""),
    )
    .at(-1);
  const requiredDod = contract.definition_of_done?.release || [
    "build",
    "tests",
    "e2e",
    "security",
    "rollback",
    "approval",
  ];
  if (!releaseReview) {
    const found = [
      ...new Set(
        releaseReviewCandidates
          .map((record) => record.data?.release_id)
          .filter(Boolean),
      ),
    ];
    add(
      "release_review",
      "fail",
      `no release review bound to ${release?.data?.id || "(none)"}${
        found.length ? `; found reviews bound to ${found.join(", ")}` : ""
      }`,
    );
  } else if (releaseReview.error) {
    add(
      "release_review",
      "fail",
      `release review is invalid: ${releaseReview.error}`,
    );
  } else {
    add(
      "release_review",
      "pass",
      `release review found: ${relative(projectDir, releaseReview.file)}`,
    );
    if (releaseReview.data.module_id !== "RELEASE") {
      add(
        "release_review_module",
        "fail",
        `release review module_id ${releaseReview.data.module_id} is not RELEASE`,
      );
    }
    const releaseData = release?.data || {};
    if (releaseReview.data.release_id !== releaseData.id) {
      add(
        "release_review_release",
        "fail",
        `release review is bound to ${releaseReview.data.release_id || "(none)"}, not ${releaseData.id || "(none)"}`,
      );
    } else if (releaseReview.data.version !== releaseData.version) {
      add(
        "release_review_release",
        "fail",
        `release review version ${releaseReview.data.version || "(none)"} does not match ${releaseData.version || "(none)"}`,
      );
    } else if (releaseReview.data.environment !== releaseData.environment) {
      add(
        "release_review_release",
        "fail",
        `release review environment ${releaseReview.data.environment || "(none)"} does not match ${releaseData.environment || "(none)"}`,
      );
    } else {
      add(
        "release_review_release",
        "pass",
        `release review is bound to ${releaseData.id} ${releaseData.version} (${releaseData.environment})`,
      );
    }
    if (
      !releaseReview.data.reviewer ||
      releaseReview.data.reviewer.independent !== true ||
      !releaseReview.data.reviewer.agent ||
      !releaseReview.data.reviewer.session ||
      !releaseReview.data.reviewer.model ||
      isImplementationRole(releaseReview.data.reviewer.agent)
    ) {
      add(
        "release_review_independence",
        "fail",
        "release review has incomplete independent reviewer metadata (agent/session/model required)",
      );
    } else {
      add(
        "release_review_independence",
        "pass",
        `release reviewer ${releaseReview.data.reviewer.agent} is marked independent`,
      );
      if (!isRealSessionId(releaseReview.data.reviewer.session)) {
        const enforce = requiresRealSession(releaseReview.data.created_at);
        add(
          "release_review_session",
          enforce ? "fail" : "warn",
          `release reviewer.session ${releaseReview.data.reviewer.session} is not a real ses_ session id; ${
            enforce
              ? "reviews created on or after 2026-11-20 must use the actual OpenCode session id"
              : "legacy reviews before 2026-11-20 only warn"
          }`,
        );
      }
    }

    const second = release?.data?.approval?.second_review;
    if (release?.data?.environment !== "sandbox" && second) {
      if (second.review_id === releaseReview.data.review_id) {
        add(
          "release_second_review_distinct",
          "fail",
          "second review cannot reuse the main RELEASE review",
        );
      } else if (
        second.model === releaseReview.data.reviewer?.model ||
        (second.reviewer_agent &&
          second.reviewer_agent === releaseReview.data.reviewer?.agent) ||
        (second.reviewer_session &&
          second.reviewer_session === releaseReview.data.reviewer?.session)
      ) {
        add(
          "release_second_review_distinct",
          "fail",
          "second review must use a different model/agent/session from the main RELEASE review",
        );
      } else {
        add(
          "release_second_review_distinct",
          "pass",
          "second review is distinct from the main RELEASE review",
        );
      }
    }

    const reviewedEvidence = releaseReview.data.reviewed_evidence || [];
    const releaseEvidenceIds = release?.data?.evidence || [];
    if (!reviewedEvidence.length) {
      add(
        "release_review_evidence",
        "fail",
        "release review does not list reviewed_evidence",
      );
    } else {
      const missing = releaseEvidenceIds.filter(
        (evidenceId) => !reviewedEvidence.includes(evidenceId),
      );
      if (missing.length) {
        add(
          "release_review_evidence",
          "fail",
          `release review does not cover: ${missing.join(", ")}`,
        );
      } else {
        add(
          "release_review_evidence",
          "pass",
          `release review covers ${releaseEvidenceIds.length} release evidence reference(s)`,
        );
      }
      const evidence = readEvidence(projectDir);
      const evidenceById = new Map(
        evidence.map((record) => [record.id, record]),
      );
      const reviewTime = Date.parse(releaseReview.data.created_at || "");
      const stale = reviewedEvidence
        .map((evidenceId) => evidenceById.get(evidenceId))
        .filter(Boolean)
        .filter((record) => {
          const finished = Date.parse(record.finished_at || "");
          return (
            Number.isNaN(reviewTime) ||
            (!Number.isNaN(finished) && reviewTime < finished)
          );
        });
      if (Number.isNaN(reviewTime)) {
        add(
          "release_review_fresh",
          "fail",
          "release review has no valid created_at",
        );
      } else if (stale.length) {
        add(
          "release_review_fresh",
          "fail",
          `release review predates evidence: ${stale
            .map((record) => record.id)
            .join(", ")}`,
        );
      } else {
        add(
          "release_review_fresh",
          "pass",
          "release review is newer than its evidence",
        );
      }
    }

    if (releaseReview.data.verdict !== "pass") {
      add(
        "release_verdict",
        "fail",
        `release review verdict is ${releaseReview.data.verdict}, expected pass`,
      );
    } else {
      add("release_verdict", "pass", "release review verdict is pass");
    }
    for (const key of requiredDod) {
      if (releaseReview.data.dod?.[key] === true) {
        add(`release_dod:${key}`, "pass", `release DoD ${key} passed`);
      } else {
        add(
          `release_dod:${key}`,
          "fail",
          `release DoD ${key} is not marked true in the review`,
        );
      }
    }
    for (const check of reviewClosureChecks(releaseReview.data, {
      prefix: "release_finding",
    })) {
      add(check.id, check.status, check.message);
    }
  }

  const openBlocking = readDecisions(projectDir).filter(
    (record) =>
      !record.error &&
      record.data?.status === "open" &&
      record.data?.blocking === true,
  );
  if (openBlocking.length) {
    add(
      "decisions",
      "fail",
      `${openBlocking.length} blocking decision(s) are still open: ${openBlocking
        .map((record) => record.data.decision_id)
        .join(", ")}`,
    );
  } else {
    add("decisions", "pass", "no blocking decisions are open");
  }

  return {
    ok: errors.length === 0,
    checked_at: nowIso(),
    release_id: release?.data?.id || null,
    environment: release?.data?.environment || options.environment || null,
    release_path: release?.file ? relative(projectDir, release.file) : null,
    review_path: releaseReview?.file
      ? relative(projectDir, releaseReview.file)
      : null,
    dod: requiredDod,
    checks,
    errors,
    warnings,
  };
}

/**
 * @param {string} projectDir
 * @param {any} result
 */
export function recordReleaseResult(projectDir, result) {
  const { state } = loadProject(projectDir);
  state.release_gate = {
    status: result.ok ? "pass" : "fail",
    release_id: result.release_id,
    environment: result.environment,
    checked_at: result.checked_at,
    reasons: result.errors,
    warnings: result.warnings,
  };
  state.updated_at = nowIso();
  saveState(projectDir, state);
}

/**
 * @param {any} result
 * @returns {string}
 */
export function renderReleaseReport(result) {
  const lines = [];
  lines.push(
    `Release ${result.release_id || "(none)"}: ${
      result.ok ? "PASS" : "FAIL"
    } (${result.checked_at})`,
  );
  for (const check of result.checks) {
    const mark =
      check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
    lines.push(`  ${mark} ${check.message}`);
  }
  if (result.warnings.length) lines.push(`Warnings: ${result.warnings.length}`);
  if (result.errors.length) lines.push(`Errors: ${result.errors.length}`);
  return lines.join("\n");
}

/**
 * @param {{
 *   projectDir: string,
 *   version: string,
 *   environment: 'sandbox'|'staging'|'production',
 *   scope: string,
 *   artifacts?: Record<string, string>,
 *   evidence?: string[]
 * }} input
 * @returns {{ file: string, data: any }}
 */
export function createRelease(input) {
  const { project, paths } = loadProject(input.projectDir);
  ensureDir(paths.releases);
  const existing = readReleases(input.projectDir);
  const releaseId = nextId(
    "REL",
    existing.map((record) => record.data?.id).filter(Boolean),
  );
  const createdAt = nowIso();
  const data = {
    schema_version: 1,
    id: releaseId,
    version: input.version,
    environment: input.environment,
    scope: input.scope,
    status: "draft",
    risk_tier: project.risk_tier,
    artifacts: {
      threat_model: input.artifacts?.threat_model || "",
      load_test: input.artifacts?.load_test || "",
      rollback_drill: input.artifacts?.rollback_drill || "",
      runbook: input.artifacts?.runbook || "",
    },
    evidence: input.evidence || [],
    created_at: createdAt,
    updated_at: createdAt,
  };
  assertSchema("release.schema.json", data, `release ${releaseId}`);

  const body = [
    `# ${releaseId}：${data.version} (${data.environment})`,
    "",
    "## 范围",
    "",
    data.scope,
    "",
    "## 产物",
    "",
    "| 产物 | 路径 |",
    "|---|---|",
    `| 威胁模型 | ${data.artifacts.threat_model || "（未填）"} |`,
    `| 负载测试 | ${data.artifacts.load_test || "（未填）"} |`,
    `| 回滚演练 | ${data.artifacts.rollback_drill || "（未填）"} |`,
    `| Runbook | ${data.artifacts.runbook || "（未填）"} |`,
    "",
    "## 批准",
    "",
    "尚未批准。运行 `riccon release approve` 前必须有用户明确的批准决策。",
    "",
  ].join("\n");
  const file = join(paths.releases, `${releaseId}.md`);
  writeText(file, stringifyFrontmatter(data, body));
  return { file, data };
}

/**
 * @param {string} projectDir
 * @param {string} releaseId
 * @param {string} decisionId
 * @param {{ secondReviewModel?: string, secondReviewEvidence?: string[] }} [options]
 * @returns {{ file: string, data: any }}
 */
export function approveRelease(
  projectDir,
  releaseId,
  decisionId,
  options = {},
) {
  const record = readReleases(projectDir).find(
    (item) => item.data?.id === releaseId,
  );
  if (!record || !record.data) {
    fail(`release ${releaseId} not found`, { code: "ERR_RELEASE_NOT_FOUND" });
  }
  if (record.error) {
    fail(`release ${releaseId} is invalid: ${record.error}`, {
      code: "ERR_RELEASE_INVALID",
    });
  }
  if (record.data.status !== "draft") {
    fail(
      `release ${releaseId} is ${record.data.status}; only draft releases can be approved`,
      { code: "ERR_RELEASE_STATE" },
    );
  }
  if (record.data.risk_tier === "T4") {
    const sandbox = checkSandbox(projectDir);
    if (!sandbox.ok) {
      fail(
        `release ${releaseId} cannot be approved; T4 sandbox check failed: ${sandbox.errors.join("; ")}`,
        { code: "ERR_SANDBOX" },
      );
    }
  }
  const decision = approvalDecisionForRelease(
    projectDir,
    record.data,
    decisionId,
  );
  const approvedAt = nowIso();

  let secondReview = null;
  if (record.data.risk_tier === "T4" && record.data.environment !== "sandbox") {
    const model = String(options.secondReviewModel || "").trim();
    if (!model) {
      fail("T4 staging/production approval requires --second-review-model", {
        code: "ERR_SECOND_REVIEW",
      });
    }
    if (!options.secondReviewPath) {
      fail("T4 staging/production approval requires --second-review-path", {
        code: "ERR_SECOND_REVIEW",
      });
    }
    const result = validateSecondReview(
      projectDir,
      record.data,
      options.secondReviewPath,
      model,
    );
    if (result.errors.length) {
      fail(`second review is invalid: ${result.errors.join("; ")}`, {
        code: "ERR_SECOND_REVIEW",
      });
    }
    secondReview = {
      model,
      review_id: result.review.review_id,
      review_path: result.relativePath,
      review_sha256: result.reviewHash,
      reviewer_agent: result.review.reviewer?.agent || null,
      reviewer_session: result.review.reviewer?.session || null,
      verdict: "pass",
      evidence: [...(result.review.reviewed_evidence || [])],
    };
  }

  const data = {
    ...record.data,
    status: "approved",
    approval: {
      by: "user",
      decision_id: decisionId,
      release_id: record.data.id,
      environment: record.data.environment,
      answer_kind: decision.answer_kind,
      answer_sha256: sha256(String(decision.answer).trim()),
      release_sha256: releaseContentHash(record.data, projectDir, {
        secondReviewPath: secondReview?.review_path,
      }),
      ...(secondReview ? { second_review: secondReview } : {}),
      approved_at: approvedAt,
    },
    updated_at: approvedAt,
  };
  assertSchema("release.schema.json", data, `release ${releaseId}`);
  const body = [
    `# ${releaseId}：${data.version} (${data.environment})`,
    "",
    "## 范围",
    "",
    data.scope,
    "",
    "## 产物",
    "",
    "| 产物 | 路径 |",
    "|---|---|",
    `| 威胁模型 | ${data.artifacts.threat_model || "（未填）"} |`,
    `| 负载测试 | ${data.artifacts.load_test || "（未填）"} |`,
    `| 回滚演练 | ${data.artifacts.rollback_drill || "（未填）"} |`,
    `| Runbook | ${data.artifacts.runbook || "（未填）"} |`,
    "",
    "## 批准",
    "",
    `- 批准人：${data.approval.by}`,
    `- 决策：${data.approval.decision_id}`,
    `- Release：${data.approval.release_id}`,
    `- 环境：${data.approval.environment}`,
    `- 回答类型：${data.approval.answer_kind}`,
    `- 回答哈希：${data.approval.answer_sha256}`,
    `- 时间：${data.approval.approved_at}`,
    "",
  ].join("\n");
  writeText(record.file, stringifyFrontmatter(data, body));
  return { file: record.file, data };
}

/** @param {string} projectDir */
export function listReleases(projectDir) {
  return releaseRecords(projectDir).map((record) => ({
    file: record.file,
    data: record.data,
    error: record.error,
  }));
}

/**
 * @param {string} projectDir
 * @param {string} releaseId
 */
export function showRelease(projectDir, releaseId) {
  const record = readReleases(projectDir).find(
    (item) => item.data?.id === releaseId,
  );
  if (!record || !record.data) {
    fail(`release ${releaseId} not found`, { code: "ERR_RELEASE_NOT_FOUND" });
  }
  return record;
}
