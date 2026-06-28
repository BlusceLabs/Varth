import { constants, accessSync, copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { BINARY_PATH, runBinary } from "./harness.js"

describe("binary smoke tests", () => {
	it("binary exists and is executable", () => {
		accessSync(BINARY_PATH, constants.X_OK)
	})

	it("--version exits cleanly", () => {
		const result = runBinary({
			args: ["--version"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
		})
		expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
	})

	it("--help exits cleanly", () => {
		const result = runBinary({
			args: ["--help"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
		})
		expect(result.stdout).toContain("Usage")
	})

	it("--help shows varth subcommands, harness flags, and env vars (no pi internals)", () => {
		const result = runBinary({
			args: ["--help"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
		})
		// Subcommand catalogue
		expect(result.stdout).toContain("Subcommands:")
		expect(result.stdout).toContain("varth setup")
		expect(result.stdout).toContain("varth claude")
		expect(result.stdout).toContain("varth opencode")
		expect(result.stdout).toContain("varth cursor")
		expect(result.stdout).toContain("varth openclaw")
		expect(result.stdout).toContain("varth gsd2")
		// Curated harness flags forwarded to pi
		expect(result.stdout).toContain("--provider")
		expect(result.stdout).toContain("--mode")
		expect(result.stdout).toContain("--continue")
		// Varth-only env vars
		expect(result.stdout).toContain("VARTH_API_KEY")
		// Pi-internal extension management commands and provider-specific env
		// vars must not leak into varth's help screen.
		expect(result.stdout).not.toContain("install <source>")
		expect(result.stdout).not.toContain("ANTHROPIC_API_KEY")
		expect(result.stdout).not.toContain("OPENAI_API_KEY")
	})

	it("version subcommand prints version + platform without launching the harness", () => {
		const result = runBinary({
			args: ["version"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
		})
		expect(result.stdout).toMatch(/^varth (?:dev|\d+\.\d+\.\d+)/)
		expect(result.stdout).toContain("platform:")
	})

	it("unknown arg falls through to the harness (pi prints the unrecognised-flag warning)", () => {
		// Pi treats unknown flags as extension flags and surfaces a diagnostic.
		// We just need to assert the dispatcher didn't intercept — the easiest
		// signal is that the harness session attempts to run (stderr contains
		// pi's startup diagnostics, not our "not implemented" stub message).
		const result = runBinary({
			args: ["--definitely-not-a-real-flag=value"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
			throwOnError: false,
			timeoutMs: 5_000,
		})
		expect(result.stdout + result.stderr).not.toContain("not implemented yet on this branch")
	})

	it("prompt templates are embedded in binary (no extension errors on startup)", () => {
		const result = runBinary({
			args: ["-p", "hello"],
			extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
			throwOnError: false,
		})
		// The orchestration extension fires "input" and "before_agent_start" events, triggering template loading. If templates are missing from the compiled binary, the extension runner reports ENOENT via "Extension error" on stderr.
		expect(result.stderr).not.toContain("Extension error")
	})

	describe("--export", () => {
		const fixtureSrc = resolve("tests/smoke/fixtures/session.jsonl")
		let workDir: string

		beforeEach(() => {
			workDir = mkdtempSync(join(tmpdir(), "varth-smoke-export-"))
		})

		afterEach(() => {
			rmSync(workDir, { recursive: true, force: true })
		})

		it("exports a session to HTML using staged template assets", () => {
			// Copy the fixture into a scratch dir — the binary rewrites the jsonl on load to populate IDs, which would mutate the checked-in file.
			const sessionPath = join(workDir, "session.jsonl")
			copyFileSync(fixtureSrc, sessionPath)
			const outPath = join(workDir, "session.html")
			const result = runBinary({
				args: ["--export", sessionPath, outPath],
				extraEnv: { VARTH_API_KEY: "smoke-test-dummy" },
			})
			expect(result.stdout).toContain(outPath)
			// Output must load the template + vendor bundle (marked + highlight ≈ 200KB), so 10KB is a safe regression floor.
			expect(statSync(outPath).size).toBeGreaterThan(10_000)
			const html = readFileSync(outPath, "utf-8")
			expect(html).toContain("window.__VARTH_VERSION")
			expect(html).toContain('class="info-label">Version:')
		})
	})

	it.skipIf(!process.env.VARTH_API_KEY)("sends a request to a model via -p flag", { retry: 2 }, () => {
		const result = runBinary({
			args: ["--debug-prompts", "-p", "respond with only the word hello"],
			extraEnv: { VARTH_API_KEY: process.env.VARTH_API_KEY as string },
		})
		expect(result.stdout.trim()).not.toBe("")
	})
})
