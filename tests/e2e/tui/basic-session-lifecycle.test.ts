import { expect, test } from "@microsoft/tui-test"
import { TUI_TEST_CONFIG, runVarthSession } from "./support/varth-fixture.js"

test.use(TUI_TEST_CONFIG)

test("basic session lifecycle", async ({ terminal }) => {
	await runVarthSession(
		terminal,
		{
			artifactName: "basic-session-lifecycle",
			responses: [{ stream: ["Hello", " from", " fake", " Varth."] }],
		},
		async (fixture) => {
			terminal.submit("Say hello")

			await expect(terminal.getByText("Hello from fake Varth.", { full: true })).toBeVisible()
			expect(fixture.fake.requests.some((request) => request.url.startsWith("/openai/v1/chat/completions"))).toBe(true)
		},
	)
})
