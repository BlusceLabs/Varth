// Install the compiled binary and share directory to ~/.local/.
// Run after `pnpm run build:binary`.
//
// Usage: node scripts/install-local.js

import { cpSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const distBin = join(projectRoot, "dist", "bin", "varth")
const distShare = join(projectRoot, "dist", "share", "varth")

if (!existsSync(distBin)) {
	console.error("dist/bin/varth not found — run `pnpm run build:binary` first.")
	process.exit(1)
}
if (!existsSync(distShare)) {
	console.error("dist/share/varth/ not found — run `pnpm run build:binary` first.")
	process.exit(1)
}

const prefix = join(homedir(), ".local")
const binDest = join(prefix, "bin")
const shareDest = join(prefix, "share", "varth")

mkdirSync(binDest, { recursive: true })
cpSync(distBin, join(binDest, "varth"))

cpSync(distShare, shareDest, { recursive: true })

console.log(`Installed binary  → ${join(binDest, "varth")}`)
console.log(`Installed share   → ${shareDest}`)
