import { join } from "node:path";
import { readJson } from "./fsx.mjs";
import { SCHEMAS_DIR } from "./paths.mjs";

/**
 * 从 module schema 读取验收状态枚举，避免在代码里再维护一份副本。
 * schema 是数据契约的唯一事实源；本模块只补充“哪些状态算未完成”的语义。
 */
const moduleSchema = readJson(join(SCHEMAS_DIR, "module.schema.json"));
const acceptanceSchema =
  moduleSchema.properties?.product_acceptance?.properties || {};

export const PRODUCT_STATUSES = Object.freeze([
  ...(acceptanceSchema.product_status?.enum || []),
]);
export const USER_STATUSES = Object.freeze([
  ...(acceptanceSchema.user_status?.enum || []),
]);

/**
 * Product 预验收未完成的状态集合。
 * 从 schema 枚举派生：除 `pass` 和旧项目兼容值 `not-recorded` 外都算未完成。
 * 新增状态默认按未完成处理，避免静默放行。
 */
export const OPEN_PRODUCT_STATUSES = Object.freeze(
  PRODUCT_STATUSES.filter(
    (status) => !["pass", "not-recorded"].includes(status),
  ),
);

/**
 * 用户最终验收未完成的状态集合。
 * 从 schema 枚举派生：除 `accepted` 和旧项目兼容值 `not-recorded` 外都算未完成。
 */
export const OPEN_USER_STATUSES = Object.freeze(
  USER_STATUSES.filter(
    (status) => !["accepted", "not-recorded"].includes(status),
  ),
);

/**
 * @param {any} module
 * @returns {boolean}
 */
export function isAcceptanceOpen(module) {
  const acceptance = module?.product_acceptance;
  if (!acceptance) return false;
  return (
    OPEN_PRODUCT_STATUSES.includes(acceptance.product_status) ||
    OPEN_USER_STATUSES.includes(acceptance.user_status)
  );
}

/**
 * @param {any} module
 * @returns {boolean}
 */
export function hasProductPass(module) {
  return module?.product_acceptance?.product_status === "pass";
}

/**
 * @param {any} module
 * @returns {boolean}
 */
export function isAccepted(module) {
  return (
    hasProductPass(module) &&
    module?.product_acceptance?.user_status === "accepted"
  );
}

/**
 * 用户最终验收结论；必须晚于模块 done 才能记录。
 */
export const FINAL_USER_STATUSES = Object.freeze([
  "accepted",
  "rejected",
  "conditional",
]);
