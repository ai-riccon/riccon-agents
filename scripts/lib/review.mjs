/**
 * 评审会话 ID 和 finding 闭环的共享校验。
 *
 * 真实 OpenCode 会话 ID 至少 20 位字母数字；`ses_xxx`、`test-session` 等占位值
 * 不能通过。2026-11-20 之前的旧 review 只产生 warning，保留兼容窗口。
 */
export const REAL_SESSION_ENFORCED_FROM = Date.parse(
  "2026-11-20T00:00:00+08:00",
);

/**
 * finding 闭环从 2026-11-22 起强制。
 *
 * 之前的评审可能把 open P2/P3 当作“已通过但待办”；为了不追溯失败，旧评审只
 * warning。新评审必须把每条 finding 明确为 fixed 或 accepted。
 */
export const REVIEW_CLOSURE_ENFORCED_FROM = Date.parse(
  "2026-11-22T00:00:00+08:00",
);

/**
 * @param {unknown} session
 * @returns {boolean}
 */
export function isRealSessionId(session) {
  return /^ses_[A-Za-z0-9]{20,}$/.test(String(session || ""));
}

/**
 * @param {unknown} createdAt
 * @returns {boolean}
 */
export function requiresRealSession(createdAt) {
  const time = Date.parse(String(createdAt || ""));
  return Number.isFinite(time) && time >= REAL_SESSION_ENFORCED_FROM;
}

/**
 * @param {unknown} createdAt
 * @returns {boolean}
 */
export function requiresReviewClosure(createdAt) {
  const time = Date.parse(String(createdAt || ""));
  return Number.isFinite(time) && time >= REVIEW_CLOSURE_ENFORCED_FROM;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function filled(value) {
  return String(value ?? "").trim().length > 0;
}

/**
 * 校验一组 finding 是否满足 pass 条件。
 *
 * 规则：
 * - P0/P1 必须 fixed，accepted 也不允许；
 * - P2/P3 不能保持 open，必须 fixed 或 accepted；
 * - accepted 必须写 owner、due、accepted_reason，便于后续继续跟踪。
 *
 * @param {any[]} findings
 * @param {{ prefix?: string, enforce?: boolean, legacyBlocking?: boolean }} [options]
 * @returns {{ id: string, status: 'fail' | 'warn', message: string }[]}
 */
export function findingClosureChecks(
  findings,
  { prefix = "finding", enforce = false, legacyBlocking = true } = {},
) {
  const checks = [];
  for (const finding of findings || []) {
    const severity = finding?.severity;
    const status = finding?.status;
    const findingId = finding?.id || "(none)";
    const title = finding?.title ? `: ${finding.title}` : "";
    const blocking = severity === "P0" || severity === "P1";

    if (blocking && status !== "fixed") {
      const shouldFail = enforce || legacyBlocking;
      checks.push({
        id: `${prefix}:${findingId}`,
        status: shouldFail ? "fail" : "warn",
        message: `${severity} finding ${findingId} is ${status}; P0/P1 must be fixed before pass${
          shouldFail ? "" : " (legacy review only warns)"
        }${title}`,
      });
      continue;
    }

    if (!blocking && status === "open") {
      checks.push({
        id: `${prefix}:${findingId}`,
        status: enforce ? "fail" : "warn",
        message: `${severity || "?"} finding ${findingId} is open; ${
          enforce
            ? "new pass reviews must fix it or mark it accepted with owner/due/accepted_reason"
            : "legacy review only warns"
        }${title}`,
      });
      continue;
    }

    if (status === "accepted") {
      const missing = ["owner", "due", "accepted_reason"].filter(
        (key) => !filled(finding?.[key]),
      );
      if (missing.length) {
        checks.push({
          id: `${prefix}:${findingId}`,
          status: enforce ? "fail" : "warn",
          message: `${severity || "?"} finding ${findingId} is accepted but missing ${missing.join(
            ", ",
          )}; ${
            enforce
              ? "new accepted findings require owner/due/accepted_reason"
              : "legacy review only warns"
          }${title}`,
        });
      }
    }
  }
  return checks;
}

/**
 * 校验一份评审是否满足 finding 闭环；只对 pass 评审生效。
 *
 * @param {any} review
 * @param {{ prefix?: string, enforce?: boolean, legacyBlocking?: boolean }} [options]
 * @returns {{ id: string, status: 'fail' | 'warn', message: string }[]}
 */
export function reviewClosureChecks(
  review,
  { prefix = "finding", enforce, legacyBlocking = true } = {},
) {
  if (review?.verdict !== "pass") return [];
  return findingClosureChecks(review?.findings || [], {
    prefix,
    enforce: enforce ?? requiresReviewClosure(review?.created_at),
    legacyBlocking,
  });
}

/**
 * 取每个任务最新的一份 task review；同时间按文件路径稳定排序。
 *
 * @param {{ file: string, data: any | null, error: string | null }[]} taskReviews
 * @returns {Map<string, { file: string, data: any | null, error: string | null }>}
 */
export function latestTaskReviews(taskReviews) {
  const latest = new Map();
  for (const record of taskReviews || []) {
    const taskId = record?.data?.task_id;
    if (!taskId) continue;
    const current = latest.get(taskId);
    if (!current) {
      latest.set(taskId, record);
      continue;
    }
    const nextTime = Date.parse(String(record.data?.created_at || ""));
    const currentTime = Date.parse(String(current.data?.created_at || ""));
    const nextKey = `${Number.isFinite(nextTime) ? nextTime : 0}:${record.file}`;
    const currentKey = `${Number.isFinite(currentTime) ? currentTime : 0}:${current.file}`;
    if (nextKey > currentKey) latest.set(taskId, record);
  }
  return latest;
}

/**
 * 校验模块评审是否覆盖本模块每个任务的最新 task review。
 *
 * 不要求每个任务都有 task review；只要求已有的 task review 被模块评审显式读取。
 *
 * @param {any} moduleReview
 * @param {{ file: string, data: any | null, error: string | null }[]} taskReviews
 * @param {{ prefix?: string, enforce?: boolean }} [options]
 * @returns {{ id: string, status: 'fail' | 'warn', message: string }[]}
 */
export function reviewTaskCoverageChecks(
  moduleReview,
  taskReviews,
  { prefix = "review_task_coverage", enforce } = {},
) {
  if (moduleReview?.module_id === "RELEASE") return [];
  if (moduleReview?.verdict !== "pass") return [];

  const shouldEnforce =
    enforce ?? requiresReviewClosure(moduleReview?.created_at);
  const moduleId = moduleReview?.module_id;
  const relevant = (taskReviews || []).filter(
    (record) => record?.data?.module_id === moduleId,
  );
  const latest = latestTaskReviews(relevant);
  if (!latest.size) return [];

  const listed = new Set(
    (moduleReview?.reviewed_task_reviews || []).map((item) => String(item)),
  );
  const checks = [];
  for (const [taskId, record] of latest) {
    const reviewId = record?.data?.review_id;
    if (!reviewId || listed.has(reviewId)) continue;
    checks.push({
      id: `${prefix}:${reviewId}`,
      status: shouldEnforce ? "fail" : "warn",
      message: `module review does not list latest task review ${reviewId} for ${taskId}; add it to reviewed_task_reviews`,
    });
  }
  return checks;
}
