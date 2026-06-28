import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, resolve } from "node:path"
import { getVersion } from "./utils.js"

const VARTH_API = "https://llm.varth.dev"
const MODELS_REGISTRY_URL = "https://models.jabez.co.ke/api.json"
const MODELS_CONFIG_PATH = resolve(homedir(), ".config", "varth", "models.json")
const FETCH_TIMEOUT_MS = 20000

function normalizeVarthEndpoint(endpoint?: string): string {
	const trimmed = endpoint?.trim()
	return (trimmed && trimmed.length > 0 ? trimmed : VARTH_API).replace(/\/+$/, "")
}

function modelsMetadataApi(endpoint?: string): string {
	return `${normalizeVarthEndpoint(endpoint)}/v1/models/metadata?include_in_cli=true`
}

function chatCompletionsApi(endpoint?: string): string {
	return `${normalizeVarthEndpoint(endpoint)}/openai/v1`
}

// HTTP statuses worth retrying: rate limiting and transient gateway/server errors.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_FETCH_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 4000

/**
 * Error raised when the model metadata API cannot be reached. `transient` marks
 * failures that are expected to clear on their own (rate limiting, gateway/server
 * errors, network blips) so callers can offer "try again" instead of treating the
 * user's saved API key as invalid.
 */
export class ModelsFetchError extends Error {
	readonly status?: number
	readonly transient: boolean
	constructor(message: string, options: { status?: number; transient: boolean }) {
		super(message)
		this.name = "ModelsFetchError"
		this.status = options.status
		this.transient = options.transient
	}
}

/** True when `error` is a transient (retryable) model-refresh failure. */
export function isTransientModelsError(error: unknown): boolean {
	return error instanceof ModelsFetchError && error.transient
}

export interface FetchModelsOptions {
	/** Injected sleep for deterministic tests; defaults to a setTimeout-based delay. */
	sleep?: (ms: number) => Promise<void>
	/** Base Varth service endpoint; defaults to https://llm.varth.dev. */
	endpoint?: string
	/** When false, fetch failures throw even if models.json contains cached models. */
	allowCachedFallback?: boolean
	/** When true, an API response with no active models throws instead of writing an empty varth-dev block. */
	requireActiveModels?: boolean
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Delay before the next retry, honoring a `Retry-After` header when present.
function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
	if (retryAfterHeader) {
		const seconds = Number(retryAfterHeader)
		if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
		const dateMs = Date.parse(retryAfterHeader)
		if (!Number.isNaN(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), MAX_RETRY_DELAY_MS)
	}
	return Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
}

export interface ModelMetadata {
	slug: string
	display_name: string
	provider: string
	reasoning: boolean
	input_modalities: ("text" | "image")[]
	is_serverless: boolean
	limits: {
		context_window: number
		max_output_tokens: number
	}
	status?: "active" | "sunset" | "deprecated"
	replacement?: string
}

interface ModelsMetadataResponse {
	models: ModelMetadata[]
}

function sortModels(models: ModelMetadata[]): ModelMetadata[] {
	const serverless = models.filter((m) => m.is_serverless)
	const rest = models.filter((m) => !m.is_serverless)
	return [...serverless, ...rest]
}

async function fetchAvailableModels(apiKey: string, options: FetchModelsOptions = {}): Promise<ModelMetadata[]> {
	const sleep = options.sleep ?? defaultSleep
	const metadataUrl = modelsMetadataApi(options.endpoint)
	let lastError: ModelsFetchError | undefined

	for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
		let response: Response
		try {
			response = await fetch(metadataUrl, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			})
		} catch (err) {
			if (attempt === MAX_FETCH_ATTEMPTS) {
				throw new ModelsFetchError(`Failed to fetch models: ${err instanceof Error ? err.message : String(err)}`, {
					transient: true,
				})
			}
			await sleep(retryDelayMs(null, attempt))
			continue
		}

		if (response.ok) {
			const body = (await response.json()) as ModelsMetadataResponse
			if (!Array.isArray(body?.models)) {
				throw new ModelsFetchError("Unexpected response shape from models API", { transient: false })
			}
			if (body.models.length === 0) {
				throw new ModelsFetchError("API returned empty model list", { transient: false })
			}
			return body.models
		}

		const transient = RETRYABLE_STATUSES.has(response.status)
		lastError = new ModelsFetchError(`Failed to fetch models: ${response.status} ${response.statusText}`, {
			status: response.status,
			transient,
		})
		if (!transient || attempt === MAX_FETCH_ATTEMPTS) throw lastError
		await sleep(retryDelayMs(response.headers?.get?.("retry-after"), attempt))
	}

	// Unreachable: the loop returns on success or throws on the final attempt.
	throw lastError ?? new ModelsFetchError("Failed to fetch models", { transient: true })
}

export interface PiModelConfig {
	id: string
	name: string
	reasoning: boolean
	input: ("text" | "image")[]
	contextWindow: number
	maxTokens: number
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
	// Persisted so telemetry can resolve the actual upstream provider after cache round-trip.
	provider: string
	compat?: { supportsReasoningEffort?: boolean; cacheControlFormat?: "anthropic" }
	/** Model-level API type: upstream custom-provider parseModels falls through to this field. */
	api?: string
	/** Model-level base URL: upstream custom-provider parseModels falls through to this field. */
	baseUrl?: string
}

function metadataToModel(m: ModelMetadata): PiModelConfig {
	// TODO: our LiteLLM gateway does not support `thinking.type.enabled` for Anthropic >Opus 4.6 models
	// Therefore, we disable it for now. Revisit, once we upgrade our LiteLLM version.
	const compat =
		m.provider === "anthropic"
			? ({ supportsReasoningEffort: false, cacheControlFormat: "anthropic" } as const)
			: undefined
	return {
		id: m.slug,
		name: m.display_name.trim().length > 0 ? m.display_name : m.slug,
		reasoning: m.reasoning,
		input: m.input_modalities,
		contextWindow: m.limits.context_window,
		maxTokens: m.limits.max_output_tokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// Store upstream provider for telemetry round-trip via models.json
		provider: m.provider,
		...(compat && { compat }),
	}
}

function buildModelsConfig(models: ModelMetadata[], endpoint?: string) {
	return {
		providers: {
			"varth-dev": {
				baseUrl: chatCompletionsApi(endpoint),
				apiKey: "$VARTH_API_KEY",
				api: "openai-completions",
				authHeader: true,
				headers: { "User-Agent": `varth/${getVersion()}` },
				models: models.map(metadataToModel),
			},
		},
	}
}

export interface ModelsConfigResult {
	models: ModelMetadata[]
}

function modelToMetadata(m: PiModelConfig): ModelMetadata {
	return {
		slug: m.id,
		display_name: m.name,
		// If `provider` was persisted by metadataToModel, use it. Fall back to the
		// legacy compat heuristic for files written by older CLI versions.
		provider: m.provider || (m.compat ? "anthropic" : ""),
		reasoning: m.reasoning,
		input_modalities: m.input,
		is_serverless: true,
		limits: { context_window: m.contextWindow, max_output_tokens: m.maxTokens },
	}
}

function extractModelsFromProviders(providers: Record<string, { models?: PiModelConfig[] }>): ModelMetadata[] {
	const result: ModelMetadata[] = []
	for (const [, provider] of Object.entries(providers)) {
		if (provider && typeof provider === "object" && Array.isArray(provider.models)) {
			result.push(...provider.models.map(modelToMetadata))
		}
	}
	return result
}

function readCachedMetadata(modelsJsonPath: string): ModelMetadata[] | undefined {
	try {
		const raw = readFileSync(modelsJsonPath, "utf-8")
		const parsed = JSON.parse(raw)
		const models = parsed?.providers?.["varth-dev"]?.models
		if (!Array.isArray(models) || models.length === 0) return undefined
		return (models as PiModelConfig[]).map(modelToMetadata)
	} catch {
		return undefined
	}
}

function readExistingProviders(modelsJsonPath: string): Record<string, unknown> {
	if (!existsSync(modelsJsonPath)) return {}
	try {
		const raw = readFileSync(modelsJsonPath, "utf-8")
		const config = JSON.parse(raw)
		const providers = config?.providers ?? {}
		const { "varth-dev": _varth, "varth-experimental": _exp, ...rest } = providers as Record<string, unknown>
		return rest
	} catch {
		return {}
	}
}

export async function validateApiKey(apiKey: string, options: FetchModelsOptions = {}): Promise<void> {
	await fetchAvailableModels(apiKey, options)
}

/**
 * Overwrite or insert a provider's models in models.json.
 * Used after OAuth subscription login to persist upstream models into Varth's cache.
 */
export function syncProviderModels(
	modelsJsonPath: string,
	providerId: string,
	models: PiModelConfig[],
	providerConfig?: { api?: string; baseUrl?: string },
): void {
	let config: { providers?: Record<string, { api?: string; baseUrl?: string; models?: PiModelConfig[] }> } = {}
	if (existsSync(modelsJsonPath)) {
		config = JSON.parse(readFileSync(modelsJsonPath, "utf-8"))
	}
	if (!config.providers) config.providers = {}
	config.providers[providerId] = { ...providerConfig, models }
	writeFileSync(modelsJsonPath, JSON.stringify(config, null, "\t"), "utf-8")
}

export function injectExperimentalProvider(modelsJsonPath: string, apiKey: string): void {
	if (!existsSync(modelsJsonPath)) return
	let config: { providers?: Record<string, unknown> }
	try {
		config = JSON.parse(readFileSync(modelsJsonPath, "utf-8"))
	} catch {
		return
	}
	const varthDev = config.providers?.["varth-dev"]
	if (!varthDev) return
	const experimental = {
		...(varthDev as Record<string, unknown>),
		baseUrl: "https://llm.varth.dev/experimental/openai/v1",
		apiKey,
	}
	config.providers = { ...config.providers, "varth-experimental": experimental }
	writeFileSync(modelsJsonPath, JSON.stringify(config, null, "\t"), "utf-8")
}

export function readExperimentalModels(modelsJsonPath: string): ModelMetadata[] {
	try {
		const raw = readFileSync(modelsJsonPath, "utf-8")
		const parsed = JSON.parse(raw)
		const models = parsed?.providers?.["varth-experimental"]?.models
		if (!Array.isArray(models) || models.length === 0) return []
		return (models as PiModelConfig[]).map(modelToMetadata)
	} catch {
		return []
	}
}

/**
 * Fetch available models from the varth metadata API and write the
 * configuration to modelsJsonPath. If no API key is configured, returns
 * cached models (if available) or an empty list without making a network call.
 * If the fetch fails and the previous models.json is still on disk, returns
 * the cached models with a warning. Throws only when a key is present but
 * there is no cache to fall back on.
 *
 * User-added providers (anything other than "varth-dev") are preserved across
 * updates so custom model configurations are not lost on startup.
 */
export interface RegistryModel {
	id: string
	name: string
	reasoning: boolean
	modalities: { input: string[]; output: string[] }
	limit: { context: number; output: number }
	cost: { input: number; output: number; cache_read?: number; cache_write?: number }
}

export interface RegistryProvider {
	id: string
	name: string
	api: string
	models: Record<string, RegistryModel>
}

export type RegistryResponse = Record<string, RegistryProvider>

export async function fetchModelsFromRegistry(): Promise<RegistryResponse> {
	const response = await fetch(MODELS_REGISTRY_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!response.ok) {
		throw new ModelsFetchError(`Failed to fetch models registry: ${response.status}`, {
			status: response.status,
			transient: RETRYABLE_STATUSES.has(response.status),
		})
	}
	return (await response.json()) as RegistryResponse
}

export function registryModelToPiConfig(m: RegistryModel, providerId: string, providerApi: string): PiModelConfig {
	return {
		id: `${providerId}/${m.id}`,
		name: m.name,
		reasoning: m.reasoning,
		input: m.modalities.input as ("text" | "image")[],
		contextWindow: m.limit.context,
		maxTokens: m.limit.output,
		cost: {
			input: m.cost.input,
			output: m.cost.output,
			cacheRead: m.cost.cache_read ?? 0,
			cacheWrite: m.cost.cache_write ?? 0,
		},
		provider: providerId,
		api: "openai-completions",
		baseUrl: providerApi,
	}
}

export function saveRegistryModelsToConfig(
	registry: RegistryResponse,
	options: { apiKey?: string; endpoint?: string } = {},
): string {
	const providers: Record<
		string,
		{ baseUrl: string; apiKey: string; api: string; authHeader: boolean; models: PiModelConfig[] }
	> = {}

	for (const [providerId, provider] of Object.entries(registry)) {
		const models = Object.values(provider.models).map((m) => registryModelToPiConfig(m, providerId, provider.api))
		providers[providerId] = {
			baseUrl: provider.api,
			apiKey: options.apiKey ?? "$VARTH_API_KEY",
			api: "openai-completions",
			authHeader: true,
			models,
		}
	}

	const config = { providers }
	mkdirSync(dirname(MODELS_CONFIG_PATH), { recursive: true })
	writeFileSync(MODELS_CONFIG_PATH, JSON.stringify(config, null, "\t"), "utf-8")
	return MODELS_CONFIG_PATH
}

export async function updateModelsConfig(
	modelsJsonPath: string,
	apiKey: string,
	options: FetchModelsOptions = {},
): Promise<ModelsConfigResult> {
	const dir = dirname(modelsJsonPath)
	mkdirSync(dir, { recursive: true })

	const otherProviders = readExistingProviders(modelsJsonPath)
	const otherModels = extractModelsFromProviders(otherProviders as Record<string, { models?: PiModelConfig[] }>)

	if (!apiKey) {
		return { models: sortModels([...(readCachedMetadata(modelsJsonPath) ?? []), ...otherModels]) }
	}

	let fetched: ModelMetadata[]
	try {
		fetched = await fetchAvailableModels(apiKey, options)
	} catch (err) {
		const cached = readCachedMetadata(modelsJsonPath) ?? []
		if (options.allowCachedFallback === false || (cached.length === 0 && otherModels.length === 0)) throw err
		const message = err instanceof Error ? err.message : String(err)
		console.warn(`Failed to refresh models from API, using cached list: ${message}`)
		return { models: sortModels([...cached, ...otherModels]) }
	}

	const activeModels = fetched.filter((m) => m.status !== "sunset" && m.limits.max_output_tokens > 0)
	if (activeModels.length === 0 && fetched.length > 0) {
		if (options.requireActiveModels) {
			throw new ModelsFetchError("No active Varth models are available for this API key", { transient: false })
		}
		console.warn("All models from the API are sunset. No active models available.")
	}
	const models = sortModels(activeModels)
	const merged = { providers: { ...otherProviders, ...buildModelsConfig(models, options.endpoint).providers } }
	writeFileSync(modelsJsonPath, JSON.stringify(merged, null, "\t"), "utf-8")
	return { models: sortModels([...activeModels, ...otherModels]) }
}
