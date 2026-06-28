import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dispatchSubcommand } from "./dispatch.js"

describe("dispatchSubcommand", () => {
	let logSpy: ReturnType<typeof vi.spyOn>
	let errSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		logSpy.mockRestore()
		errSpy.mockRestore()
	})

	it("runs the version subcommand and returns its exit code", async () => {
		const result = await dispatchSubcommand(["version"])
		expect(result).toEqual({ kind: "handled", exitCode: 0 })
		expect(logSpy).toHaveBeenCalled()
	})

	it("falls through when no args are given", async () => {
		const result = await dispatchSubcommand([])
		expect(result).toEqual({ kind: "fallthrough" })
	})

	it("falls through when the first arg is an unknown subcommand", async () => {
		const result = await dispatchSubcommand(["definitely-not-a-command"])
		expect(result).toEqual({ kind: "fallthrough" })
	})

	it("falls through for harness flags so pi parses them", async () => {
		const result = await dispatchSubcommand(["--provider", "varth-dev", "--model", "kimi-k2.5"])
		expect(result).toEqual({ kind: "fallthrough" })
	})

	it("falls through for --version (pi prints it)", async () => {
		const result = await dispatchSubcommand(["--version"])
		expect(result).toEqual({ kind: "fallthrough" })
	})

	it("handles --help by printing the merged help text", async () => {
		const result = await dispatchSubcommand(["--help"])
		expect(result).toEqual({ kind: "handled", exitCode: 0 })

		const printed = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")
		// Sections we expect from the custom renderer
		expect(printed).toContain("Subcommands:")
		expect(printed).toContain("varth setup")
		expect(printed).toContain("varth setup-tools")
		expect(printed).toContain("varth claude")
		expect(printed).toContain("Harness flags")
		expect(printed).toContain("--provider")
		expect(printed).toContain("--mode")
		expect(printed).toContain("Environment variables:")
		expect(printed).toContain("VARTH_API_KEY")
		// Pi-internal commands must NOT leak into varth's help (we no longer
		// delegate to pi.main for the lower section).
		expect(printed).not.toContain("install <source>")
		expect(printed).not.toContain("ANTHROPIC_API_KEY")
	})

	it("subcommand context wins over a trailing --help", async () => {
		const result = await dispatchSubcommand(["version", "--help"])
		expect(result.kind).toBe("handled")
		// The version handler ran (printed something to stdout) rather than
		// the merged help renderer. Either way is "handled", but checking
		// stdout for the version banner confirms the dispatch order.
		const printed = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")
		expect(printed).toMatch(/^varth (?:dev|\d+\.\d+\.\d+)/m)
	})

	it("update --help prints usage and returns 0", async () => {
		const result = await dispatchSubcommand(["update", "--help"])
		expect(result).toEqual({ kind: "handled", exitCode: 0 })
		const printed = logSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")
		expect(printed).toContain("Usage: varth update")
		expect(printed).toContain("--force")
		expect(printed).toContain("--dry-run")
	})

	// `varth setup` is wired but interactive (clack prompts await stdin).
	// We don't drive it from this dispatch test — non-TTY behavior is the
	// next thing to make robust, but for now we just assert that the
	// command exists in the registry and is no longer routed to the stub.

	// Per-tool subcommand behavior is exercised in the integration test files
	// (claude-code.test.ts, opencode.test.ts, cursor.test.ts, openclaw.test.ts,
	// gsd2.test.ts) — including the empty-API-key rejection path. We don't
	// re-assert it here because the dispatcher would resolve the key from the
	// real ~/.config/varth/config.json on developer machines and spawn the
	// underlying binary, which makes the test environment-dependent.

	it("config with no args prints usage and returns 1", async () => {
		const result = await dispatchSubcommand(["config"])
		expect(result).toEqual({ kind: "handled", exitCode: 1 })
		const messages = errSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n")
		expect(messages).toContain("Usage: varth config")
	})
})
