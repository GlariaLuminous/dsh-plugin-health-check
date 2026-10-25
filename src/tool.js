/**
 * The model-facing `plugin_health_check` tool.
 *
 * Everything the host provides is injected: `defineTool` comes from
 * `@deepseek-ai/dsh-tools` and `audit` runs the static scan. That keeps this
 * file free of host imports, so the tests exercise it without a DSH install.
 * `src/index.js` wires the real implementations.
 *
 * The tool only reads files. It starts no plugin, runs no shell command, opens
 * no network connection and writes nothing.
 */
import { compactReport, formatSummary } from './report.js'

export const TOOL_NAME = 'plugin_health_check'
export const DEFAULT_PROFILE = 'web'

const GENERIC_FAILURE =
  'Cannot inspect DSH input; check the profile manifest, paths, arguments and runtime version.'
const MISSING_DEPENDENCIES =
  'The checker dependencies are missing; reinstall the plugin so its dependencies are installed.'

/** An argument problem whose message is written here and so safe to show. */
class ArgumentError extends Error {}

function optionalString(args, key) {
  const value = args?.[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new ArgumentError(`${key} must be a string`)
  return value
}

/** Default audit: load the scanner on first use so a missing dependency is reported, not thrown at import. */
export async function defaultAudit(options) {
  const { auditDsh } = await import('../scripts/dsh/scan.mjs')
  return auditDsh(options)
}

function failure(message) {
  return { status: 'error', exit_code: 2, summary: `error: ${message}`, report: '' }
}

/**
 * Build the tool definition.
 * @param {{ defineTool: Function, audit?: Function }} deps
 */
export function createHealthCheckTool({ defineTool, audit = defaultAudit }) {
  return defineTool({
    name: TOOL_NAME,
    description:
      'Statically check a DeepSeek Harness (DSH) profile for plugin problems: unresolved bundles, ' +
      'incompatible DSH versions, invalid or conflicting patches, and MCP serverName conflicts. ' +
      'Pass `candidate` (a local plugin source directory) to see what installing it would change before ' +
      'you install it. Read-only: it starts no plugin, runs no command and changes no configuration. ' +
      'A pass means the covered configuration checks found nothing, not that plugins run correctly; ' +
      'the result lists what was not inspected.',
    parameters: {
      profile: {
        type: 'string',
        description:
          `Profile directory name under DSH_HOME/profiles. Use "web" for the web launcher (default) ` +
          'or "desktop" for the desktop app.',
      },
      candidate: {
        type: 'string',
        description:
          'Optional local directory holding a plugin package (unpacked source) to check before installing it. ' +
          'It is never installed, built or run.',
      },
      dshVersion: {
        type: 'string',
        description:
          'Optional DSH runtime version, such as 0.2.1-rc.2. Give it only when you know it; ' +
          'otherwise it is read from the installation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            required: true,
            description: 'pass, fail, incomplete or error.',
          },
          exit_code: {
            type: 'number',
            required: true,
            description: '0 pass, 1 fatal findings, 2 input or setup error, 3 incomplete coverage.',
          },
          summary: {
            type: 'string',
            required: true,
            description: 'Readable result including findings and coverage limits.',
          },
          report: {
            type: 'string',
            required: true,
            description: 'The same result as compact JSON text; empty when status is error.',
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args) {
      try {
        const options = {
          profile: optionalString(args, 'profile') ?? DEFAULT_PROFILE,
          candidate: optionalString(args, 'candidate'),
          runtimeVersion: optionalString(args, 'dshVersion'),
        }
        const result = await audit(options)
        return {
          status: result.status,
          exit_code: result.exit_code,
          summary: formatSummary(result),
          report: JSON.stringify(compactReport(result)),
        }
      } catch (error) {
        if (error instanceof ArgumentError) return failure(error.message)
        if (error?.code === 'ERR_MODULE_NOT_FOUND') return failure(MISSING_DEPENDENCIES)
        // Parse errors can quote configuration containing credentials; never pass the text on.
        return failure(GENERIC_FAILURE)
      }
    },
  })
}
