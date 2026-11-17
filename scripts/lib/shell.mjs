/**
 * 轻量 shell 分段器：只做证据命令的“退出码是否被掩盖”判断，
 * 不执行命令，也不试图完整解析 shell 语法。
 *
 * 目标：
 * - 找出 `|`、`||`、`;`、换行后的简单命令；
 * - 识别 `echo`、`true`、`:`、`cat`、`tee`、`sleep`、`exit 0` 等
 *   会把失败状态改写成 0 的写法；
 * - 保留 `&&`、`|| exit 1` 等失败会继续传播的写法。
 */

const MASK_COMMANDS = new Set([
  "echo",
  "printf",
  "true",
  ":",
  "cat",
  "tee",
  "sleep",
  "head",
  "tail",
  "wc",
  "tr",
  "yes",
  "date",
  "pwd",
  "whoami",
  "uname",
  "seq",
]);

const SKIP_PREFIXES = new Set([
  "command",
  "builtin",
  "env",
  "nohup",
  "exec",
  "sudo",
  "doas",
  "time",
]);

const SHELL_KEYWORDS = new Set([
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
]);

/**
 * 按未加引号的 `|`、`||`、`;`、`&`、`&&` 和换行切分命令。
 * 每个片段记录它前面的分隔符；首个片段为 `start`。
 *
 * @param {unknown} value
 * @returns {{ separator: string, text: string }[]}
 */
export function shellSegments(value) {
  const text = String(value || "");
  const segments = [];
  let buffer = "";
  let quote = null;
  let escaped = false;
  let separator = "start";

  const push = () => {
    const part = buffer.trim();
    if (part) segments.push({ separator, text: part });
    buffer = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      buffer += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      buffer += char;
      escaped = true;
      continue;
    }
    if (quote) {
      buffer += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      buffer += char;
      continue;
    }
    if (char === "\n" || char === ";") {
      push();
      separator = char === "\n" ? "newline" : ";";
      continue;
    }
    if (char === "|" || char === "&") {
      let operator = char;
      if (text[index + 1] === char) {
        operator += char;
        index += 1;
      } else if (char === "|" && text[index + 1] === "&") {
        operator = "|&";
        index += 1;
      }
      push();
      separator = operator;
      continue;
    }
    buffer += char;
  }
  push();
  return segments;
}

/**
 * 取一个片段实际执行的第一个命令名（去掉 `FOO=bar`、`command`/`env`
 * 前缀、`then`/`do` 等关键字和路径）。
 *
 * @param {string} text
 * @returns {string}
 */
function firstCommandWord(text) {
  let rest = String(text || "").trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const before = rest;
    rest = rest.replace(/^[({!]\s*/, "");
    rest = rest.replace(
      /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/,
      "",
    );
    if (rest === before) break;
  }

  const tokens = rest.split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  let index = 0;
  let word = tokens[index];
  if (SHELL_KEYWORDS.has(word)) {
    index += 1;
    word = tokens[index] || "";
  }
  if (SKIP_PREFIXES.has(word)) {
    index += 1;
    while (
      index < tokens.length &&
      (tokens[index].startsWith("-") ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]))
    ) {
      index += 1;
    }
    word = tokens[index] || "";
  }
  return String(word)
    .replace(/^['"]|['"]$/g, "")
    .split("/")
    .pop()
    .toLowerCase();
}

/**
 * 检测未加引号的后台 `&`。重定向 `2>&1`、`&>`、`&&`、`|&` 不算。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasUnquotedBackground(value) {
  const text = String(value || "");
  let quote = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== "&") continue;
    if (text[index + 1] === "&") {
      index += 1;
      continue;
    }
    const before = text[index - 1] || "";
    const after = text[index + 1] || "";
    if (before === ">" || before === "|") continue;
    if (after === ">") continue;
    return true;
  }
  return false;
}

/**
 * 判断一个片段是否是 `exit 0`（含 `/bin/exit` 形式）。
 *
 * @param {string} text
 * @returns {boolean}
 */
function exitCode(text) {
  const words = String(text || "")
    .trim()
    .replace(/^[({!]\s*/, "")
    .replace(/[)};]+\s*$/, "")
    .split(/\s+/)
    .filter(Boolean);
  const command = (words[0] || "").split("/").pop();
  if (command !== "exit" || words[1] === undefined) return null;
  const code = Number(words[1]);
  if (!Number.isFinite(code)) return null;
  return ((Math.trunc(code) % 256) + 256) % 256;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isExitZero(text) {
  return exitCode(text) === 0;
}

/**
 * 判断一个片段是否是 `exit <nonzero>`（含分组/路径形式）。
 *
 * @param {string} text
 * @returns {boolean}
 */
function isExitNonZero(text) {
  const code = exitCode(text);
  return code !== null && code !== 0;
}

/**
 * 判断证据命令是否通过管道/回退/顺序分隔符把失败掩盖成 0。
 *
 * 安全写法：
 * - `npm test && echo ok`：测试失败时 echo 不执行，状态继续非 0；
 * - `npm test || exit 1`：回退命令显式传播失败；
 * - `for ...; do npm test || exit 1; done`。
 *
 * 不安全写法：
 * - `npm test | echo`、`npm test || echo ok`、`npm test; true`；
 * - `npm test || /bin/true`、`npm test | tee log`、`... ; exit 0`。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isMaskingShellCommand(value) {
  if (hasUnquotedBackground(value)) return true;
  const segments = shellSegments(value);
  if (!segments.length) return false;
  for (const segment of segments) {
    const word = firstCommandWord(segment.text);
    if (!word) continue;
    if (segment.separator === "|" || segment.separator === "|&") {
      // 没有 pipefail 的管道会用最后一个命令的退出码覆盖测试失败。
      return true;
    }
    if (segment.separator === "||" && !isExitNonZero(segment.text)) {
      // 回退分支只有显式 exit 非零才算传播失败；其余可能把失败改成 0。
      return true;
    }
    const masksAfterSeparator = [";", "newline", "start"].includes(
      segment.separator,
    );
    if (masksAfterSeparator && MASK_COMMANDS.has(word)) return true;
    if (masksAfterSeparator && isExitZero(segment.text)) return true;
  }
  return false;
}
