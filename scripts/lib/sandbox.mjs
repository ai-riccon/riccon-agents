import { join, resolve } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { loadContract } from './contract.mjs';
import { readEvidence } from './project.mjs';
import { verifyEvidenceRecord } from './evidence.mjs';

const DOC_TERMS = [
  { id: 'mounts', label: '挂载/mount', pattern: /挂载|mount/i },
  { id: 'network', label: '网络/network', pattern: /网络|network/i },
  { id: 'secrets', label: '密钥/secret', pattern: /密钥|secret/i },
  { id: 'cleanup', label: '清理/cleanup', pattern: /清理|cleanup/i },
  { id: 'limits', label: '限制/limit', pattern: /限制|limit/i },
];

/**
 * 对 `commands.sandbox` 指向的脚本做静态隔离检查。
 * 这不是 runtime attestation；它只拒绝明显没有容器隔离参数的 echo-only 脚本。
 *
 * @param {string} projectDir
 * @param {string} command
 * @returns {string[]}
 */
export function sandboxScriptIsolationErrors(projectDir, command) {
  const text = String(command || '').trim();
  const match =
    text.match(/^(?:bash|sh)\s+(\S+)/) || text.match(/^(\S+\.sh)(?:\s|$)/);
  if (!match) return [];
  const scriptPath = resolve(
    projectDir,
    match[1].replace(/^['"]|['"]$/g, ''),
  );
  if (!exists(scriptPath)) return [`sandbox script not found: ${match[1]}`];
  const script = readText(scriptPath);
  const required = [
    { pattern: /(?:docker|podman)\s+run\b/, label: 'container run' },
    { pattern: /--network\s+none\b/, label: '--network none' },
    { pattern: /--read-only\b/, label: '--read-only' },
    { pattern: /--cap-drop\s+ALL\b/i, label: '--cap-drop ALL' },
    { pattern: /(?:--user|-u)\s+\S+/, label: '--user/-u' },
  ];
  return required
    .filter((item) => !item.pattern.test(script))
    .map(
      (item) =>
        `sandbox script ${match[1]} is missing ${item.label}`,
    );
}

/**
 * @param {string} projectDir
 * @returns {any}
 */
export function checkSandbox(projectDir) {
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
    if (status === 'fail') errors.push(message);
    if (status === 'warn') warnings.push(message);
  }

  const contractResult = loadContract(projectDir);
  if (contractResult.errors.length) {
    add('contract', 'fail', `project contract is invalid: ${contractResult.errors.join('; ')}`);
    return {
      ok: false,
      tier: null,
      checks,
      errors,
      warnings,
    };
  }
  const contract = contractResult.contract;
  const tier = contract.project?.risk_tier || 'T3';
  const required = tier === 'T4';
  const sandbox = contract.sandbox || {};

  add('contract', 'pass', 'project contract is valid');
  add('risk_tier', 'pass', `risk tier is ${tier}`);

  if (sandbox.required === true) {
    add('sandbox_required', 'pass', 'sandbox.required is true');
  } else if (required) {
    add('sandbox_required', 'fail', 'T4 requires sandbox.required: true');
  } else {
    add('sandbox_required', 'warn', 'sandbox.required is not true (optional below T4)');
  }

  if (sandbox.runtime) {
    add('sandbox_runtime', 'pass', `sandbox runtime: ${sandbox.runtime}`);
  } else if (required) {
    add('sandbox_runtime', 'fail', 'T4 requires sandbox.runtime (Docker/VM/firejail/etc.)');
  } else {
    add('sandbox_runtime', 'warn', 'sandbox.runtime is empty');
  }

  const network = String(sandbox.network || '').trim().toLowerCase();
  if (required && !['none', 'allowlist'].includes(network)) {
    add(
      'sandbox_network',
      'fail',
      `T4 network policy must be none or allowlist, got ${sandbox.network || '(empty)'}`,
    );
  } else if (network === 'allowlist') {
    const allowlist = Array.isArray(sandbox.allowlist) ? sandbox.allowlist : [];
    if (!allowlist.length) {
      add(
        'sandbox_network',
        'fail',
        'sandbox.network is allowlist but sandbox.allowlist is empty',
      );
    } else {
      add(
        'sandbox_network',
        'pass',
        `sandbox network policy: allowlist (${allowlist.join(', ')})`,
      );
    }
  } else if (network) {
    add('sandbox_network', 'pass', `sandbox network policy: ${sandbox.network}`);
  } else if (required) {
    add('sandbox_network', 'fail', 'T4 requires an explicit sandbox.network policy');
  } else {
    add('sandbox_network', 'warn', 'sandbox.network is empty');
  }

  if (sandbox.secrets) {
    add('sandbox_secrets', 'pass', `sandbox secrets policy: ${sandbox.secrets}`);
  } else if (required) {
    add('sandbox_secrets', 'fail', 'T4 requires an explicit sandbox.secrets policy');
  } else {
    add('sandbox_secrets', 'warn', 'sandbox.secrets is empty');
  }

  if (Array.isArray(sandbox.mounts) && sandbox.mounts.length) {
    const unsafe = sandbox.mounts.filter(
      (mount) =>
        /:rw\b/.test(String(mount)) ||
        String(mount).startsWith('/') ||
        /host/i.test(String(mount)),
    );
    if (required && unsafe.length) {
      add(
        'sandbox_mounts',
        'fail',
        `T4 sandbox mounts must be read-only project/tmpfs mounts; unsafe: ${unsafe.join(', ')}`,
      );
    } else {
      add('sandbox_mounts', 'pass', `sandbox mounts: ${sandbox.mounts.join(', ')}`);
    }
  } else if (required) {
    add('sandbox_mounts', 'fail', 'T4 requires at least one declared sandbox.mounts entry');
  } else {
    add('sandbox_mounts', 'warn', 'sandbox.mounts is empty');
  }

  const limits = sandbox.limits || {};
  const missingLimits = ['cpus', 'memory', 'timeout_minutes'].filter(
    (key) => limits[key] === undefined || limits[key] === null || limits[key] === '',
  );
  if (!missingLimits.length) {
    add('sandbox_limits', 'pass', 'sandbox limits: cpus/memory/timeout declared');
  } else if (required) {
    add(
      'sandbox_limits',
      'fail',
      `T4 requires sandbox.limits.${missingLimits.join(', sandbox.limits.')}`,
    );
  } else {
    add('sandbox_limits', 'warn', `sandbox limits missing: ${missingLimits.join(', ')}`);
  }

  const attestationTerms = Array.isArray(sandbox.attestation_terms)
    ? sandbox.attestation_terms.map((term) => String(term).trim()).filter(Boolean)
    : [];
  if (required && !attestationTerms.length) {
    add(
      'sandbox_attestation',
      'fail',
      'T4 requires sandbox.attestation_terms (runtime markers such as network/uid/image)',
    );
  } else if (attestationTerms.length) {
    add(
      'sandbox_attestation',
      'pass',
      `sandbox attestation terms: ${attestationTerms.join(', ')}`,
    );
  }

  const command = contract.commands?.sandbox;
  if (command) {
    add('sandbox_command', 'pass', `sandbox command: ${command}`);
    const isolationErrors = sandboxScriptIsolationErrors(projectDir, command);
    if (isolationErrors.length) {
      for (const error of isolationErrors) {
        add('sandbox_script_isolation', 'fail', error);
      }
    } else {
      add(
        'sandbox_script_isolation',
        'pass',
        `sandbox script ${command} declares container isolation`,
      );
    }
  } else if (required) {
    add('sandbox_command', 'fail', 'T4 requires commands.sandbox');
  } else {
    add('sandbox_command', 'warn', 'commands.sandbox is empty');
  }

  const doc = join(projectDir, 'docs', 'SANDBOX.md');
  if (!exists(doc)) {
    if (required) {
      add('sandbox_doc', 'fail', 'T4 requires docs/SANDBOX.md');
    } else {
      add('sandbox_doc', 'warn', 'docs/SANDBOX.md not found');
    }
  } else {
    const text = readText(doc);
    const missing = DOC_TERMS.filter((term) => !term.pattern.test(text));
    if (missing.length) {
      const message = `docs/SANDBOX.md is missing: ${missing
        .map((term) => term.label)
        .join(', ')}`;
      add('sandbox_doc', required ? 'fail' : 'warn', message);
    } else {
      add('sandbox_doc', 'pass', 'docs/SANDBOX.md covers mounts/network/secrets/cleanup/limits');
    }
  }

  if (sandbox.evidence) {
    if (/^EV-[0-9]{4,}$/.test(String(sandbox.evidence).trim())) {
      const evidenceId = String(sandbox.evidence).trim();
      const record = readEvidence(projectDir).find((item) => item.id === evidenceId);
      if (!record) {
        add('sandbox_evidence', 'fail', `sandbox evidence ${evidenceId} not found`);
      } else if (record.exit_code !== 0 || record.manual === true) {
        add(
          'sandbox_evidence',
          'fail',
          `sandbox evidence ${evidenceId} is not a passing executed run`,
        );
      } else if (
        command &&
        record.command.trim() !== String(command).trim()
      ) {
        add(
          'sandbox_evidence',
          'fail',
          `sandbox evidence ${evidenceId} command "${record.command}" does not match commands.sandbox "${command}"`,
        );
      } else {
        const verification = verifyEvidenceRecord(projectDir, record, {
          requireAncestor: true,
          requireClean: true,
        });
        if (!verification.ok) {
          add('sandbox_evidence', 'fail', verification.errors.join('; '));
        } else {
          const log = readText(resolve(projectDir, record.output_path));
          const missingTerms = attestationTerms.filter((term) => !log.includes(term));
          if (missingTerms.length) {
            add(
              'sandbox_evidence',
              'fail',
              `sandbox evidence ${evidenceId} misses attestation terms: ${missingTerms.join(', ')}`,
            );
          } else {
            add(
              'sandbox_evidence',
              'pass',
              `sandbox evidence ${evidenceId} is a passing ${command} run with attestation terms`,
            );
          }
        }
      }
    } else if (required) {
      add(
        'sandbox_evidence',
        'fail',
        `T4 sandbox.evidence must reference a passing EV from commands.sandbox, got ${sandbox.evidence}`,
      );
    } else {
      const evidencePath = resolve(projectDir, sandbox.evidence);
      if (exists(evidencePath)) {
        add('sandbox_evidence', 'pass', `sandbox evidence: ${sandbox.evidence}`);
      } else {
        add('sandbox_evidence', 'fail', `sandbox evidence does not exist: ${sandbox.evidence}`);
      }
    }
  } else if (required) {
    add('sandbox_evidence', 'fail', 'T4 requires sandbox.evidence pointing to a passing EV');
  } else {
    add('sandbox_evidence', 'warn', 'sandbox.evidence is empty');
  }

  return {
    ok: errors.length === 0,
    tier,
    checks,
    errors,
    warnings,
  };
}

/**
 * @param {any} result
 * @returns {string}
 */
export function renderSandboxReport(result) {
  const lines = [
    `Sandbox: ${result.ok ? 'PASS' : 'FAIL'} (${result.tier || 'unknown'})`,
  ];
  for (const check of result.checks) {
    const mark = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
    lines.push(`  ${mark} ${check.message}`);
  }
  if (result.warnings.length) lines.push(`Warnings: ${result.warnings.length}`);
  if (result.errors.length) lines.push(`Errors: ${result.errors.length}`);
  return lines.join('\n');
}
