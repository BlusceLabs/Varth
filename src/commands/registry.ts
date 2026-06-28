export interface CommandDefinition {
	name: string
	summary: string
	/** Run this command. Receives args after the subcommand name. Should not return on success unless the command is purely informational. */
	run: (args: string[]) => Promise<number | undefined>
}

import { runClaude } from "./claude.js"
import { runConfig } from "./config.js"
import { runCursor } from "./cursor.js"
import { runGsd2 } from "./gsd2.js"
import { runOpenClaw } from "./openclaw.js"
import { runOpenCode } from "./opencode.js"
import { runResources } from "./resources.js"
import { runSetupTools } from "./setup-tools.js"
import { runSetup } from "./setup.js"
import { runUpdate } from "./update.js"
import { runVersion } from "./version.js"

export const COMMANDS: CommandDefinition[] = [
	{ name: "setup", summary: "Run the interactive setup wizard", run: runSetup },
	{ name: "setup-tools", summary: "Configure coding tools in one pass", run: runSetupTools },
	{ name: "claude", summary: "Configure Claude Code to use Varth (and launch it)", run: runClaude },
	{ name: "opencode", summary: "Configure OpenCode to use Varth (and launch it)", run: runOpenCode },
	{ name: "cursor", summary: "Configure Cursor to use Varth", run: runCursor },
	{ name: "openclaw", summary: "Configure OpenClaw to use Varth", run: runOpenClaw },
	{ name: "gsd2", summary: "Install / configure GSD2 with Varth", run: runGsd2 },
	{ name: "update", summary: "Check for and install Varth/package updates", run: runUpdate },
	{ name: "config", summary: "Inspect or change varth config (e.g. telemetry)", run: runConfig },
	{ name: "resources", summary: "Enable or disable Varth hooks, tools, extensions, and plugins", run: runResources },
	{ name: "version", summary: "Print the varth version", run: runVersion },
]

const COMMAND_NAMES = new Set(COMMANDS.map((c) => c.name))

export function isKnownCommand(name: string | undefined): boolean {
	return name !== undefined && COMMAND_NAMES.has(name)
}

export function findCommand(name: string): CommandDefinition | undefined {
	return COMMANDS.find((c) => c.name === name)
}
