/**
 * dsh-plugin-health-check — DeepSeek Harness plugin entry.
 *
 * Registers one read-only tool, `plugin_health_check`, against the `tools`
 * service. Registration happens inside `apply` so the Cordis fiber owns it:
 * stopping or reloading the plugin removes the tool.
 *
 * This file is only wiring. The tool itself lives in `./tool.js` and is tested
 * without a DSH install.
 * @module dsh-plugin-health-check
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

import { createHealthCheckTool } from './tool.js'

/** Cordis plugin name, shown in loader diagnostics and the runtime plugin tree. */
export const name = 'plugin-health-check'

/** `tools` is required: without a registry there is nothing to register into. */
export const inject = ['tools']

/**
 * @param ctx - the injected Cordis context, with `tools` resolved.
 */
export function apply(ctx) {
  ctx.tools.register(createHealthCheckTool({ defineTool }))
}
