import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

interface ToolUsage {
	[name: string]: number
}

interface ModelUsage {
	[model: string]: {
		messages: number
		tokens: number
		cost: number
	}
}

interface StatsData {
	totalMessages: number
	totalTokens: number
	totalCost: number
	toolUsage: ToolUsage
	modelUsage: ModelUsage
	sessions: number
	startDate: string
	lastDate: string
}

const STATS_DIR = join(homedir(), ".config", "varth", "stats")
const STATS_FILE = join(STATS_DIR, "usage.json")

function loadStats(): StatsData {
	try {
		if (existsSync(STATS_FILE)) {
			return JSON.parse(readFileSync(STATS_FILE, "utf-8"))
		}
	} catch {}
	return {
		totalMessages: 0,
		totalTokens: 0,
		totalCost: 0,
		toolUsage: {},
		modelUsage: {},
		sessions: 0,
		startDate: new Date().toISOString(),
		lastDate: new Date().toISOString(),
	}
}

function saveStats(stats: StatsData): void {
	mkdirSync(STATS_DIR, { recursive: true })
	stats.lastDate = new Date().toISOString()
	writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))
}

function formatNumber(num: number): string {
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
	if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
	return num.toString()
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`
}

function renderRow(label: string, value: string, width = 52): string {
	const padding = Math.max(0, width - label.length - value.length)
	return `│${label}${" ".repeat(padding)}${value} │`
}

function renderBar(count: number, maxCount: number, maxWidth = 20): string {
	const barLen = Math.max(1, Math.floor((count / maxCount) * maxWidth))
	return "█".repeat(barLen)
}

export default function statsExtension(pi: ExtensionAPI) {
	pi.registerCommand("stats", {
		description: "Show usage statistics and metrics",
		handler: async (args, ctx) => {
			const stats = loadStats()
			const lines: string[] = []

			const width = 52
			const border = (s: string) => `┌${"─".repeat(s.length)}┐`
			const header = (s: string) => {
				const pad = Math.max(0, width - 2 - s.length)
				const left = Math.floor(pad / 2)
				const right = pad - left
				return `│${" ".repeat(left)}${s}${" ".repeat(right)} │`
			}
			const sep = () => `├${"─".repeat(width)}┤`
			const end = () => `└${"─".repeat(width)}┘`

			lines.push(border("─".repeat(width)))
			lines.push(header("OVERVIEW"))
			lines.push(sep())
			lines.push(renderRow("Sessions", String(stats.sessions)))
			lines.push(renderRow("Messages", String(stats.totalMessages)))
			lines.push(
				renderRow("Days", String(Math.max(1, Math.ceil((Date.now() - Date.parse(stats.startDate)) / 86400000)))),
			)
			lines.push(end())

			lines.push("")
			lines.push(border("─".repeat(width)))
			lines.push(header("COST & TOKENS"))
			lines.push(sep())
			lines.push(renderRow("Total Cost", formatCost(stats.totalCost)))
			lines.push(renderRow("Total Tokens", formatNumber(stats.totalTokens)))
			lines.push(end())

			const toolEntries = Object.entries(stats.toolUsage).sort((a, b) => b[1] - a[1])
			if (toolEntries.length > 0) {
				lines.push("")
				lines.push(border("─".repeat(width)))
				lines.push(header("TOOL USAGE"))
				lines.push(sep())
				const maxCount = toolEntries[0][1]
				const totalTools = toolEntries.reduce((sum, [, count]) => sum + count, 0)
				for (const [tool, count] of toolEntries.slice(0, 10)) {
					const bar = renderBar(count, maxCount)
					const pct = ((count / totalTools) * 100).toFixed(1)
					const name = tool.length > 18 ? `${tool.slice(0, 16)}..` : tool
					const pad = Math.max(0, 18 - name.length)
					lines.push(`│${name}${" ".repeat(pad)} ${bar} ${String(count).padStart(5)} (${pct.padStart(5)}%) │`)
				}
				lines.push(end())
			}

			const modelEntries = Object.entries(stats.modelUsage).sort((a, b) => b[1].messages - a[1].messages)
			if (modelEntries.length > 0) {
				lines.push("")
				lines.push(border("─".repeat(width)))
				lines.push(header("MODEL USAGE"))
				lines.push(sep())
				for (const [model, usage] of modelEntries.slice(0, 5)) {
					lines.push(renderRow(model, `${usage.messages} msgs, ${formatNumber(usage.tokens)} tok`))
				}
				lines.push(end())
			}

			ctx.ui.notify(lines.join("\n"), "info")
		},
	})

	pi.on?.("message_end", (event) => {
		if (event.message.role !== "assistant") return

		const stats = loadStats()
		stats.totalMessages++
		stats.sessions = Math.max(1, stats.sessions)

		const msg = event.message as unknown as Record<string, unknown>
		const metadata = msg.metadata as Record<string, unknown> | undefined
		const assistant = metadata?.assistant as Record<string, unknown> | undefined
		if (assistant) {
			const tokens = assistant.tokens as Record<string, number> | undefined
			if (tokens) {
				const total = (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0)
				stats.totalTokens += total
			}
			const cost = assistant.cost as number | undefined
			if (cost) stats.totalCost += cost

			const modelID = assistant.modelID as string | undefined
			const providerID = assistant.providerID as string | undefined
			if (modelID && providerID) {
				const key = `${providerID}/${modelID}`
				if (!stats.modelUsage[key]) {
					stats.modelUsage[key] = { messages: 0, tokens: 0, cost: 0 }
				}
				stats.modelUsage[key].messages++
				if (tokens) stats.modelUsage[key].tokens += (tokens.input || 0) + (tokens.output || 0)
				if (cost) stats.modelUsage[key].cost += cost
			}
		}

		const parts = msg.parts as Array<Record<string, unknown>> | undefined
		if (parts) {
			for (const part of parts) {
				if (part.type === "tool") {
					const toolName = part.tool as string | undefined
					if (toolName) {
						stats.toolUsage[toolName] = (stats.toolUsage[toolName] || 0) + 1
					}
				}
			}
		}

		saveStats(stats)
	})
}
