import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Key, isKeyRelease, matchesKey } from "@earendil-works/pi-tui"

interface Message {
	role: string
	content: string | Array<{ type: string; text?: string }>
	timestamp?: number
}

function extractText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content
	if (Array.isArray(content)) {
		return content
			.filter((b) => b.type === "text")
			.map((b) => b.text || "")
			.join("\n")
	}
	return ""
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str
	return `${str.slice(0, maxLen - 3)}...`
}

export default function timelineExtension(pi: ExtensionAPI) {
	pi.registerCommand("timeline", {
		description: "Show session message timeline for quick navigation",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Timeline is only available in TUI mode.", "info")
				return
			}

			const messages: Message[] = []
			const session = (ctx as unknown as { session?: { messages?: Message[] } }).session
			if (session?.messages) {
				messages.push(...session.messages)
			}

			if (messages.length === 0) {
				ctx.ui.notify("No messages in session.", "info")
				return
			}

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					let selectedIndex = 0
					let scrollOffset = 0

					const userMessages = messages.map((msg, idx) => ({ msg, idx })).filter(({ msg }) => msg.role === "user")

					if (userMessages.length === 0) {
						setTimeout(() => done(undefined), 100)
						return { render: () => ["No user messages."], invalidate: () => {}, handleInput: () => {} }
					}

					function viewportHeight(): number {
						const maxH = Math.floor(tui.terminal.rows * 0.7)
						return Math.max(5, maxH - 5)
					}

					function ensureVisible() {
						const vp = viewportHeight()
						if (selectedIndex < scrollOffset) scrollOffset = selectedIndex
						else if (selectedIndex >= scrollOffset + vp) scrollOffset = selectedIndex - vp + 1
					}

					return {
						render(width: number): string[] {
							const innerW = Math.max(30, width - 2)
							const out: string[] = []
							const border = (s: string) => theme.fg("border", s)

							const titleText = " Session Timeline "
							const borderLen = innerW - titleText.length
							const leftB = Math.floor(borderLen / 2)
							const rightB = borderLen - leftB

							out.push(
								`${border(`\u256D${"\u2500".repeat(leftB)}`)}${theme.fg("dim", titleText)}${border(`${"\u2500".repeat(rightB)}\u256E`)}`,
							)

							const vp = viewportHeight()
							const maxScroll = Math.max(0, userMessages.length - vp)
							if (scrollOffset > maxScroll) scrollOffset = maxScroll

							const visible = userMessages.slice(scrollOffset, scrollOffset + vp)
							for (let i = 0; i < visible.length; i++) {
								const { msg, idx } = visible[i]
								const globalIdx = scrollOffset + i
								const isSelected = globalIdx === selectedIndex
								const text = extractText(msg.content)
								const preview = truncate(text.replace(/\n/g, " "), 50)
								const cursor = isSelected ? `${theme.fg("accent", "\u203A")} ` : "  "
								const num = String(idx + 1).padStart(3)

								if (isSelected) {
									out.push(`${cursor}${theme.bold(theme.fg("text", `#${num} ${preview}`))}`)
								} else {
									out.push(`${cursor}${theme.fg("muted", `#${num} ${preview}`)}`)
								}
							}

							if (userMessages.length > vp) {
								if (scrollOffset > 0) out.push(`  ${theme.fg("dim", `\u2191 ${scrollOffset} more`)}`)
								if (scrollOffset < maxScroll)
									out.push(`  ${theme.fg("dim", `\u2193 ${maxScroll - scrollOffset} more`)}`)
							}

							out.push(border(`\u2570${"\u2500".repeat(innerW)}\u256F`))
							return out
						},
						invalidate() {},
						handleInput(data: string): void {
							if (isKeyRelease(data)) return
							if (matchesKey(data, Key.escape) || data === "q") {
								done(undefined)
								return
							}
							if (matchesKey(data, Key.up) || data === "k") {
								if (selectedIndex > 0) {
									selectedIndex--
									ensureVisible()
								}
							} else if (matchesKey(data, Key.down) || data === "j") {
								if (selectedIndex < userMessages.length - 1) {
									selectedIndex++
									ensureVisible()
								}
							} else if (matchesKey(data, Key.enter)) {
								const { idx } = userMessages[selectedIndex]
								ctx.ui.notify(`Navigate to message #${idx + 1}`, "info")
								done(undefined)
							}
						},
						wantsKeyRelease: false,
					}
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "70%", maxHeight: "75%" },
				},
			)
		},
	})
}
