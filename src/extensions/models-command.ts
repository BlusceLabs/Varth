import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Key, isKeyRelease, matchesKey } from "@earendil-works/pi-tui"
import {
	extractModelsFromProviders,
	fetchModelsFromRegistry,
	saveRegistryModelsToConfig,
} from "../models.js"
import { getAvailableModels, setAvailableModels } from "../startup-context.js"

export interface ModelsCommandOptions {
	/** Filter output to a single provider ID. */
	provider?: string
	/** Refresh the models cache before listing. */
	refresh?: boolean
	/** Include verbose model metadata (JSON dump) when true. */
	verbose?: boolean
}

function parseModelsArgs(args: string): ModelsCommandOptions {
	const tokens = args.trim().split(/\s+/).filter(Boolean)
	const options: ModelsCommandOptions = {}
	const positional: string[] = []
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]
		if (tok === "--refresh") {
			options.refresh = true
		} else if (tok === "--verbose") {
			options.verbose = true
		} else if (tok.startsWith("--")) {
			// Unknown flag; ignore for forward-compat.
		} else {
			positional.push(tok)
		}
	}
	if (positional.length > 0) options.provider = positional[0]
	return options
}

function formatTokenCount(count: number): string {
	if (count >= 1_000_000) {
		const millions = count / 1_000_000
		return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`
	}
	if (count >= 1_000) {
		const thousands = count / 1_000
		return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`
	}
	return count.toString()
}

interface ModelEntry {
	provider: string
	slug: string
	displayName: string
	contextWindow: number
	maxOutput: number
	reasoning: boolean
	vision: boolean
	status?: string
}

function getModelEntries(): ModelEntry[] {
	const models = getAvailableModels()
	return models
		.filter((m) => m.status !== "sunset" && m.limits.max_output_tokens > 0)
		.map((m) => ({
			provider: m.provider,
			slug: m.slug,
			displayName: m.display_name || m.slug,
			contextWindow: m.limits.context_window,
			maxOutput: m.limits.max_output_tokens,
			reasoning: m.reasoning,
			vision: m.input_modalities.includes("image"),
			status: m.status,
		}))
}

function groupByProvider(entries: ModelEntry[]): Map<string, ModelEntry[]> {
	const groups = new Map<string, ModelEntry[]>()
	for (const e of entries) {
		const key = e.provider || "unknown"
		if (!groups.has(key)) groups.set(key, [])
		groups.get(key)?.push(e)
	}
	return groups
}

function fuzzyMatch(query: string, text: string): boolean {
	if (!query) return true
	const q = query.toLowerCase()
	const t = text.toLowerCase()
	let qi = 0
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) qi++
	}
	return qi === q.length
}

function getRecentModelsPath(): string {
	return join(homedir(), ".config", "varth", "recent-models.json")
}

function loadRecentModels(): Array<{ provider: string; slug: string; timestamp: number }> {
	try {
		const data = readFileSync(getRecentModelsPath(), "utf-8")
		return JSON.parse(data)
	} catch {
		return []
	}
}

function saveRecentModels(recent: Array<{ provider: string; slug: string; timestamp: number }>): void {
	try {
		const dir = join(homedir(), ".config", "varth")
		mkdirSync(dir, { recursive: true })
		writeFileSync(getRecentModelsPath(), JSON.stringify(recent.slice(0, 20), null, 2))
	} catch {}
}

async function refreshModels(): Promise<ModelEntry[]> {
	const registry = await fetchModelsFromRegistry()
	const modelsJsonPath = saveRegistryModelsToConfig(registry)
	const raw = readFileSync(modelsJsonPath, "utf-8")
	const config = JSON.parse(raw) as Record<string, { models?: unknown[] }>
	const models = extractModelsFromProviders(config)
	setAvailableModels(models)
	return getModelEntries()
}

function printProviderModels(
	provider: string,
	entries: ModelEntry[],
	opts: { verbose?: boolean; currentId?: string },
): string[] {
	const lines: string[] = []
	const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug))
	for (const m of sorted) {
		const marker = opts.currentId === m.slug ? "* " : "  "
		lines.push(`${marker}${provider}/${m.slug}`)
		if (opts.verbose) {
			lines.push(
				JSON.stringify(
					{
						display_name: m.displayName,
						reasoning: m.reasoning,
						vision: m.vision,
						context_window: m.contextWindow,
						max_output_tokens: m.maxOutput,
						status: m.status ?? "active",
					},
					null,
					2,
				),
			)
		}
	}
	return lines
}

export default function modelsCommandExtension(pi: ExtensionAPI) {
	pi.registerCommand("models", {
		description: "List and switch available models",
		handler: async (args, ctx) => {
			const opts = parseModelsArgs(args ?? "")

			if (opts.refresh) {
				try {
					await refreshModels()
					ctx.ui.notify("Models cache refreshed.", "info")
				} catch (err) {
					ctx.ui.notify(`Failed to refresh models: ${err instanceof Error ? err.message : String(err)}`, "error")
					return
				}
			}

			let entries = getModelEntries()
			if (opts.provider) {
				entries = entries.filter((e) => e.provider === opts.provider)
				if (entries.length === 0) {
					ctx.ui.notify(`Provider not found: ${opts.provider}`, "error")
					return
				}
			}

			if (entries.length === 0) {
				ctx.ui.notify("No models available.", "info")
				return
			}

			if (opts.verbose) {
				const lines: string[] = []
				const grouped = groupByProvider(entries)
				const currentId = ctx.model?.id
				for (const [provider, models] of grouped) {
					lines.push(`\n${provider}`)
					lines.push(...printProviderModels(provider, models, { verbose: true, currentId }))
				}
				ctx.ui.notify(lines.join("\n").trim(), "info")
				return
			}

			if (ctx.mode !== "tui") {
				const lines: string[] = []
				const grouped = groupByProvider(entries)
				const currentId = ctx.model?.id
				for (const [provider, models] of grouped) {
					lines.push(`\n${provider}`)
					lines.push(...printProviderModels(provider, models, { verbose: false, currentId }))
				}
				ctx.ui.notify(lines.join("\n").trim(), "info")
				return
			}

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					const grouped = groupByProvider(entries)
					const providers = [...grouped.keys()].sort()
					let selectedIndex = 0
					let scrollOffset = 0
					let searchQuery = ""
					let searchMode = false
					const currentModel = ctx.model
					const recentModels = loadRecentModels()

					interface FlatItem {
						kind: "header" | "model" | "recent"
						provider?: string
						entry?: ModelEntry
						recentEntry?: { provider: string; slug: string; timestamp: number }
					}

					function buildFlatItems(): FlatItem[] {
						const items: FlatItem[] = []
						const q = searchQuery.trim()

						if (!q) {
							const recent = recentModels.slice(0, 5)
							if (recent.length > 0) {
								items.push({ kind: "header", provider: "Recent" })
								for (const r of recent) {
									const entry = entries.find((e) => e.provider === r.provider && e.slug === r.slug)
									if (entry) {
										items.push({ kind: "recent", entry, recentEntry: r })
									}
								}
							}
						}

						for (const provider of providers) {
							const providerModels = grouped.get(provider)
							if (!providerModels) continue

							const filtered = q
								? providerModels.filter(
										(m) => fuzzyMatch(q, m.displayName) || fuzzyMatch(q, m.slug) || fuzzyMatch(q, provider),
									)
								: providerModels

							if (filtered.length === 0) continue

							items.push({ kind: "header", provider })
							for (const m of filtered) {
								items.push({ kind: "model", entry: m })
							}
						}

						return items
					}

					let flatItems = buildFlatItems()
					const selectableIndices: number[] = []
					for (let i = 0; i < flatItems.length; i++) {
						if (flatItems[i].kind === "model" || flatItems[i].kind === "recent") {
							selectableIndices.push(i)
						}
					}

					if (selectableIndices.length > 0 && currentModel) {
						const idx = selectableIndices.findIndex((i) => {
							const item = flatItems[i]
							return (
								(item.kind === "model" && item.entry?.slug === currentModel.id) ||
								(item.kind === "recent" && item.entry?.slug === currentModel.id)
							)
						})
						if (idx >= 0) selectedIndex = idx
					}

					function viewportHeight(): number {
						const maxH = Math.floor(tui.terminal.rows * 0.85)
						return Math.max(5, maxH - 5)
					}

					function ensureVisible() {
						const vp = viewportHeight()
						if (selectedIndex < scrollOffset) scrollOffset = selectedIndex
						else if (selectedIndex >= scrollOffset + vp) scrollOffset = selectedIndex - vp + 1
					}

					function renderContent(width: number): string[] {
						const lines: string[] = []
						const vp = viewportHeight()
						const selectableLines = selectableIndices.length
						const maxScroll = Math.max(0, selectableLines - vp)
						if (scrollOffset > maxScroll) scrollOffset = maxScroll

						const firstVisible = selectableIndices[scrollOffset]
						const lastVisible = Math.min(
							selectableIndices[scrollOffset + vp - 1] ?? flatItems.length - 1,
							flatItems.length - 1,
						)

						for (let i = 0; i < flatItems.length; i++) {
							const item = flatItems[i]
							if (item.kind === "header") {
								if (i >= firstVisible && i <= lastVisible) {
									lines.push(`  ${theme.fg("accent", item.provider ?? "")}`)
								}
							} else {
								if (i < firstVisible || i > lastVisible) continue
								const globalIdx = selectableIndices.indexOf(i)
								const isSelected = globalIdx === selectedIndex
								const isCurrent = currentModel?.id === item.entry?.slug
								const e = item.entry
								if (!e) continue
								const cursor = isSelected ? `${theme.fg("accent", "\u203A")} ` : "  "

								const tags: string[] = []
								if (e.reasoning) tags.push("think")
								if (e.vision) tags.push("vision")
								if (e.status === "deprecated") tags.push("deprecated")
								const tagStr = tags.length > 0 ? ` ${theme.fg("muted", `[${tags.join(", ")}]`)}` : ""

								const ctxStr = formatTokenCount(e.contextWindow)
								const outStr = formatTokenCount(e.maxOutput)

								const nameCol = e.displayName.padEnd(36)
								const ctxCol = `ctx:${ctxStr}`.padStart(10)
								const outCol = `out:${outStr}`.padStart(10)
								const detail = `${nameCol} ${ctxCol} ${outCol}${tagStr}`

								if (isSelected) {
									lines.push(`${cursor}${theme.bold(theme.fg("text", detail))}`)
								} else if (isCurrent) {
									lines.push(`${cursor}${theme.fg("accent", detail)}`)
								} else {
									lines.push(`${cursor}${theme.fg("muted", detail)}`)
								}
							}
						}

						const hasScroll = selectableLines > vp
						if (hasScroll && scrollOffset > 0) {
							lines.unshift(`  ${theme.fg("dim", `\u2191 ${scrollOffset} more above`)}`)
						}
						if (hasScroll && scrollOffset < maxScroll) {
							lines.push(`  ${theme.fg("dim", `\u2193 ${maxScroll - scrollOffset} more below`)}`)
						}

						return lines
					}

					function onSelect(provider: string, slug: string) {
						const recent = recentModels.filter((r) => !(r.provider === provider && r.slug === slug))
						recent.unshift({ provider, slug, timestamp: Date.now() })
						saveRecentModels(recent)

						const modelObj = ctx.modelRegistry?.find(provider, slug)
						if (modelObj) {
							pi.setModel(modelObj).then(() => done(undefined))
						}
					}

					return {
						render(width: number): string[] {
							const innerW = Math.max(30, width - 2)
							const out: string[] = []
							const border = (s: string) => theme.fg("border", s)

							const titleText = searchMode ? ` Search: ${searchQuery}_` : " Models "
							const borderLen = innerW - titleText.length
							const leftB = Math.floor(borderLen / 2)
							const rightB = borderLen - leftB

							out.push(
								`${border(`\u256D${"\u2500".repeat(leftB)}`)}${theme.fg("dim", titleText)}${border(`${"\u2500".repeat(rightB)}\u256E`)}`,
							)

							const content = renderContent(innerW - 2)
							for (const line of content) {
								const padded = line.length < innerW ? line + " ".repeat(innerW - line.length) : line
								out.push(`${border("\u2502")} ${padded} ${border("\u2502")}`)
							}

							out.push(`${border("\u2502")}${" ".repeat(innerW)}${border("\u2502")}`)
							const hint = searchMode
								? "Esc: cancel search \u00B7 Enter: select"
								: "/: search \u00B7 Enter: select \u00B7 Esc: close"
							const hintLine = `  ${theme.fg("dim", hint)}`
							const paddedHint = hintLine.length < innerW ? hintLine + " ".repeat(innerW - hintLine.length) : hintLine
							out.push(`${border("\u2502")}${paddedHint}${border("\u2502")}`)
							out.push(`${border(`\u2570${"\u2500".repeat(innerW)}\u256F`)}`)

							return out
						},
						invalidate() {},
						handleInput(data: string): void {
							if (isKeyRelease(data)) return

							if (searchMode) {
								if (data === "\x1b" || data === "Escape") {
									searchMode = false
									searchQuery = ""
									flatItems = buildFlatItems()
									selectableIndices.length = 0
									for (let i = 0; i < flatItems.length; i++) {
										if (flatItems[i].kind === "model" || flatItems[i].kind === "recent") {
											selectableIndices.push(i)
										}
									}
									selectedIndex = 0
									scrollOffset = 0
									return
								}
								if (data === "\x7f" || data === "Backspace") {
									searchQuery = searchQuery.slice(0, -1)
								} else if (data === "\r" || data === "\n") {
									searchMode = false
									const flatIdx = selectableIndices[selectedIndex]
									const item = flatItems[flatIdx]
									if (item?.kind === "model" && item.entry) {
										onSelect(item.entry.provider, item.entry.slug)
									} else if (item?.kind === "recent" && item.entry) {
										onSelect(item.entry.provider, item.entry.slug)
									}
									return
								} else if (data.length === 1 && data >= " ") {
									searchQuery += data
								}

								flatItems = buildFlatItems()
								selectableIndices.length = 0
								for (let i = 0; i < flatItems.length; i++) {
									if (flatItems[i].kind === "model" || flatItems[i].kind === "recent") {
										selectableIndices.push(i)
									}
								}
								selectedIndex = 0
								scrollOffset = 0
								return
							}

							if (data === "\x1b" || data === "Escape" || data === "q") {
								done(undefined)
								return
							}

							if (data === "/") {
								searchMode = true
								searchQuery = ""
								return
							}

							if (matchesKey(data, Key.up) || data === "k") {
								if (selectedIndex > 0) {
									selectedIndex--
									ensureVisible()
								}
							} else if (matchesKey(data, Key.down) || data === "j") {
								if (selectedIndex < selectableIndices.length - 1) {
									selectedIndex++
									ensureVisible()
								}
							} else if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
								const flatIdx = selectableIndices[selectedIndex]
								const item = flatItems[flatIdx]
								if (item?.kind === "model" && item.entry) {
									onSelect(item.entry.provider, item.entry.slug)
								} else if (item?.kind === "recent" && item.entry) {
									onSelect(item.entry.provider, item.entry.slug)
								}
							}
						},
						wantsKeyRelease: false,
					}
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "80%", maxHeight: "85%" },
				},
			)
		},
	})
}
