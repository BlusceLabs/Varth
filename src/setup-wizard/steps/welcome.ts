import { readFileSync } from "node:fs"
import { join } from "node:path"
import { intro, note } from "@clack/prompts"

/**
 * Welcome step — print the varth banner, version, and a one-shot
 * controls listing the user can refer back to throughout the wizard
 * (the per-prompt UI is plain clack, so there's no live footer; this
 * note is the wizard's single source of truth for keyboard shortcuts).
 */
export function runWelcomeStep(): void {
	intro("varth setup")
	note(
		[
			"This wizard will:",
			"  · setup your Varth API key",
			"  · install/update RTK for bash command rewriting",
			"",
			"Controls:",
			"  ↑/↓     navigate options",
			"  space   toggle option (multi-select)",
			"  y / n   answer yes/no prompts",
			"  ↵       confirm and continue",
			"  esc     go back one step",
			"  ctrl+c  cancel and exit",
			"",
			`varth v${readVarthVersion()}`,
		].join("\n"),
		"What this does",
	)
}

function readVarthVersion(): string {
	try {
		// package.json sits two dirs up from src/setup-wizard/steps/.
		const pkgPath = join(import.meta.dirname, "..", "..", "..", "package.json")
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string }
		return pkg.version
	} catch {
		return "unknown"
	}
}
