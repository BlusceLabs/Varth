import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

interface ExportOptions {
	sanitized?: boolean
	format?: "json" | "markdown"
}

function sanitizeContent(content: string): string {
	return content
		.replace(/\/[\w/.-]+\.(js|ts|py|go|rs|java|cpp|c|h|hpp|rb|php|sh|bash|zsh|fish)/g, "[redacted:path]")
		.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "[redacted:email]")
		.replace(/\b(?:sk|pk|api|token|key|secret|password|auth)[_-]?[A-Za-z0-9]{16,}\b/g, "[redacted:secret]")
		.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[redacted:ip]")
		.replace(/(?:\/home|\/Users|\/root|C:\\Users)\/[\w.-]+/g, "[redacted:home]")
}

function exportAsJson(messages: Array<Record<string, unknown>>, sanitized: boolean): string {
	const exportData = messages.map((msg) => {
		const copy = { ...msg }
		if (sanitized && typeof copy.content === "string") {
			copy.content = sanitizeContent(copy.content)
		}
		if (sanitized && Array.isArray(copy.content)) {
			copy.content = copy.content.map((block: Record<string, unknown>) => {
				if (block.type === "text" && typeof block.text === "string") {
					return { ...block, text: sanitizeContent(block.text) }
				}
				return block
			})
		}
		return copy
	})
	return JSON.stringify(exportData, null, 2)
}

function exportAsMarkdown(messages: Array<Record<string, unknown>>, sanitized: boolean): string {
	const lines: string[] = ["# Session Export\n"]

	for (const msg of messages) {
		const role = (msg.role as string) || "unknown"
		let content = ""

		if (typeof msg.content === "string") {
			content = msg.content
		} else if (Array.isArray(msg.content)) {
			content = msg.content
				.filter((block: Record<string, unknown>) => block.type === "text")
				.map((block: Record<string, unknown>) => block.text as string)
				.join("\n")
		}

		if (sanitized) content = sanitizeContent(content)
		if (!content.trim()) continue

		const header = role === "user" ? "## User" : "## Assistant"
		lines.push(`${header}\n\n${content}\n`)
	}

	return lines.join("\n")
}

export default function exportExtension(pi: ExtensionAPI) {
	pi.registerCommand("dump", {
		description: "Dump session as JSON or Markdown (optionally sanitized)",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/)
			const format: "json" | "markdown" = (parts[0] as "json" | "markdown") || "json"
			const sanitized = parts.includes("--sanitize") || parts.includes("-s")

			if (format !== "json" && format !== "markdown") {
				ctx.ui.notify("Usage: /dump [json|markdown] [--sanitize]", "info")
				return
			}

			const messages: Array<Record<string, unknown>> = []
			const session = (ctx as unknown as { session?: { messages?: Array<Record<string, unknown>> } }).session
			if (session?.messages) {
				messages.push(...session.messages)
			}

			if (messages.length === 0) {
				ctx.ui.notify("No messages to export.", "info")
				return
			}

			const output = format === "json" ? exportAsJson(messages, sanitized) : exportAsMarkdown(messages, sanitized)

			const exportDir = join(homedir(), "Desktop")
			const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
			const filename = `varth-dump-${timestamp}.${format === "json" ? "json" : "md"}`
			const filepath = join(exportDir, filename)

			try {
				mkdirSync(exportDir, { recursive: true })
				writeFileSync(filepath, output)
				ctx.ui.notify(`Exported ${messages.length} messages to ${filepath}${sanitized ? " (sanitized)" : ""}`, "info")
			} catch (err) {
				ctx.ui.notify(`Export failed: ${(err as Error).message}`, "error")
			}
		},
	})
}
