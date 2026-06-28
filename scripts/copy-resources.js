// Copy non-TypeScript resources that tsc doesn't handle.
//
// --dev   (used by `build`):        theme files from node_modules → src/modes/interactive/theme/
//                                   export-html templates → src/core/export-html/
//                                   so `bun run src/cli.ts` resolves assets via pi-mono's getters
//                                   (getThemesDir, getExportTemplateDir) relative to varth's project root
//
// default (used by `build-binary`): theme files from node_modules → dist/share/varth/theme/
//                                   export-html templates → dist/share/varth/export-html/
//                                   plus package.json → dist/share/varth/
//                                   so the compiled binary resolves assets from the shared data directory

import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const piAgentDist = join(projectRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist")

const themeFiles = ["dark.json", "light.json", "theme-schema.json"]
const themeSrc = join(piAgentDist, "modes", "interactive", "theme")

// Skip TypeScript declarations and source maps when staging export-html — only template.{html,css,js}
// and vendor/*.min.js are read at runtime, so .d.ts/.map files are pure payload bloat.
const exportHtmlSkipSuffixes = [".d.ts", ".d.ts.map", ".js.map"]
const exportHtmlSrc = join(piAgentDist, "core", "export-html")

const isDev = process.argv.includes("--dev")
const themeDest = isDev
	? join(projectRoot, "src", "modes", "interactive", "theme")
	: join(projectRoot, "dist", "share", "varth", "theme")
const exportHtmlDest = isDev
	? join(projectRoot, "src", "core", "export-html")
	: join(projectRoot, "dist", "share", "varth", "export-html")

mkdirSync(themeDest, { recursive: true })
for (const file of themeFiles) {
	cpSync(join(themeSrc, file), join(themeDest, file))
}

cpSync(exportHtmlSrc, exportHtmlDest, {
	recursive: true,
	filter: (src) => !exportHtmlSkipSuffixes.some((suffix) => src.endsWith(suffix)),
})

// Post-process export HTML template to inject the varth version number.
const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"))
// Match src/utils.ts getVersion() mapping (0.0.0 → "dev").
const appVersion = pkg.version && pkg.version !== "0.0.0" ? pkg.version : "dev"
// Inject a single inline script just before </body> that sets the version
// and dynamically patches the DOM after renderHeader() has already run.
// renderHeader() stays upstream code, so this survives template.js refactors.
const templateHtmlPath = join(exportHtmlDest, "template.html")
let templateHtml = readFileSync(templateHtmlPath, "utf-8")
templateHtml = templateHtml.replace(
	"</body>",
	`<script>
(function() {
  window.__VARTH_VERSION = ${JSON.stringify(appVersion)};
  const container = document.querySelector('.header-info');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'info-item';
  el.innerHTML = '<span class="info-label">Version:</span><span class="info-value">' + window.__VARTH_VERSION + '</span>';
  container.appendChild(el);
})();
</script>
</body>`,
)
writeFileSync(templateHtmlPath, templateHtml, "utf-8")

// varth's own themes live outside node_modules — copy them alongside the upstream themes
const varthThemesSrc = join(projectRoot, "themes")
const varthThemeFiles = readdirSync(varthThemesSrc).filter((f) => f.endsWith(".json"))
for (const file of varthThemeFiles) {
	cpSync(join(varthThemesSrc, file), join(themeDest, file))
}

if (!isDev) {
	cpSync(join(projectRoot, "package.json"), join(projectRoot, "dist", "share", "varth", "package.json"))

	// Copy custom OAuth page templates
	const oauthSrc = join(projectRoot, "resources", "oauth")
	const oauthDest = join(projectRoot, "dist", "share", "varth", "oauth")
	mkdirSync(oauthDest, { recursive: true })
	cpSync(oauthSrc, oauthDest, { recursive: true })

	// Copy proxy-helper binary built by tools/proxy-helper/Makefile
	const proxyHelperSrc = join(projectRoot, "tools", "proxy-helper", "bin", "proxy-helper")
	const proxyHelperBinDest = join(projectRoot, "dist", "share", "varth", "bin")
	mkdirSync(proxyHelperBinDest, { recursive: true })
	cpSync(proxyHelperSrc, join(proxyHelperBinDest, "proxy-helper"))

	const superpowersSkillSrc = join(projectRoot, "vendor", "superpowers", "skills")
	const superpowersSkillDst = join(projectRoot, "dist", "share", "varth", "vendor", "superpowers", "skills")
	mkdirSync(superpowersSkillDst, { recursive: true })
	cpSync(superpowersSkillSrc, superpowersSkillDst, { recursive: true })
}
