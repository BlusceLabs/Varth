import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

interface SnapshotData {
	hash: string
	files: string[]
	timestamp: number
}

interface SnapshotState {
	snapshots: SnapshotData[]
	currentHash: string | null
}

const SNAPSHOT_DIR = join(homedir(), ".config", "varth", "snapshots")
const MAX_SNAPSHOTS = 50

function getStatePath(cwd: string): string {
	const safeCwd = cwd.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 64)
	return join(SNAPSHOT_DIR, `${safeCwd}.json`)
}

function loadState(cwd: string): SnapshotState {
	const path = getStatePath(cwd)
	try {
		if (existsSync(path)) {
			return JSON.parse(readFileSync(path, "utf-8"))
		}
	} catch {}
	return { snapshots: [], currentHash: null }
}

function saveState(cwd: string, state: SnapshotState): void {
	mkdirSync(SNAPSHOT_DIR, { recursive: true })
	const trimmed = state.snapshots.slice(-MAX_SNAPSHOTS)
	writeFileSync(getStatePath(cwd), JSON.stringify({ ...state, snapshots: trimmed }, null, 2))
}

function git(cwd: string, args: string[]): string {
	try {
		return execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf-8", timeout: 10000 }).trim()
	} catch {
		return ""
	}
}

function isGitRepo(cwd: string): boolean {
	return git(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true"
}

function getCurrentHash(cwd: string): string {
	return git(cwd, ["rev-parse", "HEAD"])
}

function getChangedFiles(cwd: string, sinceHash: string): string[] {
	const output = git(cwd, ["diff", "--name-only", sinceHash, "--", "."])
	if (!output) return []
	return output.split("\n").filter(Boolean)
}

function getUntrackedFiles(cwd: string): string[] {
	const output = git(cwd, ["ls-files", "--others", "--exclude-standard", "--", "."])
	if (!output) return []
	return output.split("\n").filter(Boolean)
}

function getAllChanges(cwd: string, sinceHash: string): { modified: string[]; added: string[]; deleted: string[] } {
	const statusOutput = git(cwd, ["diff", "--name-status", "--no-renames", sinceHash, "--", "."])
	const modified: string[] = []
	const added: string[] = []
	const deleted: string[] = []

	for (const line of statusOutput.split("\n").filter(Boolean)) {
		const [status, file] = line.split("\t")
		if (status === "M") modified.push(file)
		else if (status === "A") added.push(file)
		else if (status === "D") deleted.push(file)
	}

	return { modified, added, deleted }
}

function createSnapshot(cwd: string): SnapshotData | null {
	if (!isGitRepo(cwd)) return null

	const hash = getCurrentHash(cwd)
	if (!hash) return null

	const changedFiles = getChangedFiles(cwd, "HEAD~1")
	const untrackedFiles = getUntrackedFiles(cwd)
	const allFiles = [...new Set([...changedFiles, ...untrackedFiles])]

	return {
		hash,
		files: allFiles,
		timestamp: Date.now(),
	}
}

function revertToSnapshot(cwd: string, snapshot: SnapshotData): boolean {
	if (!isGitRepo(cwd)) return false

	try {
		const changes = getAllChanges(cwd, snapshot.hash)
		for (const file of changes.deleted) {
			git(cwd, ["checkout", snapshot.hash, "--", file])
		}
		for (const file of changes.modified) {
			git(cwd, ["checkout", snapshot.hash, "--", file])
		}
		return true
	} catch {
		return false
	}
}

export default function snapshotExtension(pi: ExtensionAPI) {
	pi.registerCommand("snapshot", {
		description: "Take a snapshot or revert to a previous state",
		handler: async (args, ctx) => {
			const cwd = process.cwd()

			if (!isGitRepo(cwd)) {
				ctx.ui.notify("Not a git repository. Snapshots require git.", "error")
				return
			}

			const subcommand = args.trim().split(/\s+/)[0] || "list"

			switch (subcommand) {
				case "take":
				case "save": {
					const snapshot = createSnapshot(cwd)
					if (!snapshot) {
						ctx.ui.notify("Failed to create snapshot.", "error")
						return
					}
					const state = loadState(cwd)
					state.snapshots.push(snapshot)
					state.currentHash = snapshot.hash
					saveState(cwd, state)
					ctx.ui.notify(`Snapshot taken: ${snapshot.hash.slice(0, 8)} (${snapshot.files.length} tracked files)`, "info")
					break
				}

				case "revert":
				case "restore": {
					const state = loadState(cwd)
					const indexArg = args.trim().split(/\s+/)[1]
					let target: SnapshotData | undefined

					if (indexArg) {
						const idx = Number.parseInt(indexArg, 10)
						if (!Number.isNaN(idx) && idx >= 0 && idx < state.snapshots.length) {
							target = state.snapshots[idx]
						}
					} else if (state.snapshots.length > 0) {
						target = state.snapshots[state.snapshots.length - 1]
					}

					if (!target) {
						ctx.ui.notify("No snapshot to revert to.", "error")
						return
					}

					if (revertToSnapshot(cwd, target)) {
						ctx.ui.notify(`Reverted to snapshot ${target.hash.slice(0, 8)}`, "info")
					} else {
						ctx.ui.notify("Failed to revert.", "error")
					}
					break
				}
				default: {
					const state = loadState(cwd)
					if (state.snapshots.length === 0) {
						ctx.ui.notify("No snapshots. Use /snapshot take to create one.", "info")
						return
					}

					const lines: string[] = ["Snapshots:"]
					for (let i = 0; i < state.snapshots.length; i++) {
						const s = state.snapshots[i]
						const date = new Date(s.timestamp).toLocaleString()
						lines.push(`  ${i}: ${s.hash.slice(0, 8)} - ${s.files.length} files - ${date}`)
					}
					ctx.ui.notify(lines.join("\n"), "info")
					break
				}
			}
		},
	})
}
