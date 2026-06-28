import { existsSync } from "node:fs"
import { join } from "node:path"

export function resolveAuxiliaryFilesDir(
	env: Record<string, string | undefined>,
	homeDir: string,
	execPath?: string,
): string {
	if (env.PI_PACKAGE_DIR) {
		return env.PI_PACKAGE_DIR
	}

	// When running as a compiled binary (dist/bin/varth), share files
	// live at ../share/varth relative to the binary.
	if (execPath) {
		const siblingShare = join(execPath, "..", "..", "share", "varth")
		if (existsSync(join(siblingShare, "package.json"))) {
			return siblingShare
		}
	}

	if (env.XDG_DATA_HOME) {
		return join(env.XDG_DATA_HOME, "varth")
	}

	return join(homeDir, ".local", "share", "varth")
}
