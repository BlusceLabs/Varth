import { describe, expect, it } from "vitest"
import { isWithinVarthPlans } from "./index.js"

describe("isWithinVarthPlans", () => {
	const cwd = "/home/user/myproject"

	it("allows absolute path within .varth/plans/", () => {
		expect(isWithinVarthPlans("/home/user/myproject/.varth/plans/my-plan.md", cwd)).toBe(true)
	})

	it("allows absolute path in nested subdir of .varth/plans/", () => {
		expect(isWithinVarthPlans("/home/user/myproject/.varth/plans/sub/plan.md", cwd)).toBe(true)
	})

	it("blocks absolute path outside .varth/plans/", () => {
		expect(isWithinVarthPlans("/home/user/myproject/src/index.ts", cwd)).toBe(false)
	})

	it("blocks absolute path in .varth/ but not plans/", () => {
		expect(isWithinVarthPlans("/home/user/myproject/.varth/agents/my-agent.md", cwd)).toBe(false)
	})

	it("allows relative path .varth/plans/foo.md", () => {
		expect(isWithinVarthPlans(".varth/plans/foo.md", cwd)).toBe(true)
	})

	it("blocks relative path outside plans", () => {
		expect(isWithinVarthPlans("src/index.ts", cwd)).toBe(false)
	})

	it("blocks path traversal attempt", () => {
		expect(isWithinVarthPlans("/home/user/myproject/.varth/plans/../../../etc/passwd", cwd)).toBe(false)
	})

	it("blocks absolute path from a different project", () => {
		expect(isWithinVarthPlans("/home/user/otherproject/.varth/plans/plan.md", cwd)).toBe(false)
	})

	it("cwd with trailing slash works correctly", () => {
		expect(isWithinVarthPlans("/home/user/myproject/.varth/plans/plan.md", "/home/user/myproject/")).toBe(true)
	})
})
