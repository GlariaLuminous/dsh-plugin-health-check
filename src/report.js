/**
 * Turn an `auditDsh` result into text and JSON that an agent can read.
 *
 * Pure functions: no file access, no DSH imports. The text mirrors the CLI so
 * a person and an agent see the same wording, with two additions an agent
 * needs: a cap on the number of findings, and the list of what was not checked.
 */

/** Findings printed in the summary before the rest are folded into a count. */
export const FINDING_LIMIT = 40

const NOT_INSPECTED =
  'Runtime activation, Agent presets, tool discovery and effective session permissions were not inspected.'

/**
 * Human-readable summary of a static audit.
 * @param {object} result - the object returned by `auditDsh`.
 * @param {number} [limit] - maximum findings to print.
 * @returns {string}
 */
export function formatSummary(result, limit = FINDING_LIMIT) {
  const coverage = result.coverage ?? {}
  const findings = result.findings ?? []
  const lines = [
    `DSH static profile check: ${result.profile} (runtime ${result.runtime_version || 'unknown'})`,
    `Bundles: ${coverage.resolved_bundles ?? 0}/${coverage.selected_bundles ?? 0} resolved; entries: ${result.entries?.length ?? 0}`,
  ]
  if (result.baseline) {
    lines.push(`Installed baseline: ${result.baseline.status}; fatal findings: ${result.baseline.fatal_count}`)
  }
  for (const finding of findings.slice(0, limit)) {
    lines.push(`[${String(finding.severity).toUpperCase()}] (${finding.rule}) ${finding.message}`)
    if (finding.plugins?.length) lines.push(`  plugins: ${finding.plugins.join(', ')}`)
    if (finding.source) lines.push(`  source: ${finding.source}`)
  }
  if (findings.length > limit) {
    lines.push(`... and ${findings.length - limit} more findings; the report field lists all of them.`)
  }
  if (coverage.limitations?.length) {
    lines.push('Coverage limits:')
    for (const item of coverage.limitations) lines.push(`  - ${item}`)
  }
  lines.push(`RESULT: STATIC ${String(result.status).toUpperCase()}`)
  lines.push(NOT_INSPECTED)
  return lines.join('\n')
}

/**
 * JSON report without the per-entry list, which is large and rarely useful to
 * a model. Same sanitising rules as the CLI: no config bodies, no credentials.
 * @param {object} result - the object returned by `auditDsh`.
 * @returns {object}
 */
export function compactReport(result) {
  return {
    host: result.host,
    profile: result.profile,
    runtime_version: result.runtime_version ?? null,
    status: result.status,
    exit_code: result.exit_code,
    fatal_count: result.fatal_count,
    baseline: result.baseline ?? null,
    coverage: result.coverage,
    packages: (result.packages ?? []).map(pkg => ({
      name: pkg.name,
      selected_as: pkg.selected_as,
      version: pkg.version,
      source: pkg.source,
      compatibility: pkg.compatibility?.status ?? null,
    })),
    entry_count: result.entries?.length ?? 0,
    findings: result.findings ?? [],
  }
}
