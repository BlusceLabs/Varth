import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

interface Skill {
	name: string
	description: string
	content: string
	path: string
}

function parseFrontmatter(content: string): { data: Record<string, string>; content: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
	if (!match) return { data: {}, content }

	const frontmatter: Record<string, string> = {}
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":")
		if (colonIdx > 0) {
			const key = line.slice(0, colonIdx).trim()
			const value = line.slice(colonIdx + 1).trim()
			frontmatter[key] = value
		}
	}

	return { data: frontmatter, content: match[2] }
}

function discoverSkills(dir: string, maxDepth = 3): Skill[] {
	const skills: Skill[] = []
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return skills

	function walk(currentDir: string, depth: number) {
		if (depth > maxDepth) return
		try {
			const entries = readdirSync(currentDir, { withFileTypes: true })
			for (const entry of entries) {
				const fullPath = join(currentDir, entry.name)
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					walk(fullPath, depth + 1)
				} else if (entry.name === "SKILL.md" || (entry.name.endsWith(".md") && entry.name !== "README.md")) {
					try {
						const raw = readFileSync(fullPath, "utf-8")
						const { data, content } = parseFrontmatter(raw)
						if (data.name || entry.name !== "SKILL.md") {
							skills.push({
								name: data.name || entry.name.replace(/\.md$/, ""),
								description: data.description || "",
								content,
								path: fullPath,
							})
						}
					} catch {}
				}
			}
		} catch {}
	}

	walk(dir, 0)
	return skills
}

function getSkillDirs(cwd: string): string[] {
	const dirs: string[] = []
	const home = homedir()

	const projectDirs = [".claude/skills", ".agents/skills", ".opencode/skills", ".varth/skills", "skills"]
	for (const d of projectDirs) {
		const full = join(cwd, d)
		if (existsSync(full)) dirs.push(full)
	}

	const globalDirs = [".claude/skills", ".agents/skills", ".opencode/skills", ".varth/skills"]
	for (const d of globalDirs) {
		const full = join(home, d)
		if (existsSync(full)) dirs.push(full)
	}

	return dirs
}

export default function skillExtension(pi: ExtensionAPI) {
	pi.registerCommand("skill", {
		description: "List or load available skills from SKILL.md files",
		handler: async (args, ctx) => {
			const cwd = process.cwd()
			const skillDirs = getSkillDirs(cwd)
			const allSkills: Skill[] = []

			for (const dir of skillDirs) {
				allSkills.push(...discoverSkills(dir))
			}

			const subcommand = args.trim().split(/\s+/)[0] || "list"

			if (subcommand === "list" || !subcommand) {
				if (allSkills.length === 0) {
					ctx.ui.notify(
						"No skills found. Create SKILL.md files in .claude/skills/, .agents/skills/, or skills/ directories.",
						"info",
					)
					return
				}

				const lines: string[] = [`Found ${allSkills.length} skill(s):`]
				for (let i = 0; i < allSkills.length; i++) {
					const s = allSkills[i]
					const desc = s.description ? ` - ${s.description.slice(0, 60)}` : ""
					lines.push(`  ${i + 1}. ${s.name}${desc}`)
				}
				ctx.ui.notify(lines.join("\n"), "info")
				return
			}

			const skillName = subcommand
			const skill = allSkills.find((s) => s.name === skillName)

			if (!skill) {
				const names = allSkills.map((s) => s.name).join(", ")
				ctx.ui.notify(`Skill "${skillName}" not found. Available: ${names || "none"}`, "error")
				return
			}

			const lines = [
				`--- Skill: ${skill.name} ---`,
				skill.description ? `\n${skill.description}\n` : "",
				skill.content.slice(0, 2000),
				skill.content.length > 2000 ? "\n... (truncated)" : "",
				`\n--- Path: ${skill.path} ---`,
			]
			ctx.ui.notify(lines.join("\n"), "info")
		},
	})
}
