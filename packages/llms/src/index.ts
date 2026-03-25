import { JiutianClient, type JiutianLLMConfig } from './JiutianClient'
import { OpenAIClient } from './OpenAIClient'
import { DEFAULT_TEMPERATURE, LLM_MAX_RETRIES } from './constants'
import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'

export { InvokeError, InvokeErrorType }
export type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool, JiutianLLMConfig }

/**
 * Parse LLM configuration and auto-detect provider
 */
export function parseLLMConfig(config: LLMConfig): Required<LLMConfig> {
	if (!config.baseURL || !config.model) {
		throw new Error(
			'[PageAgent] LLM configuration required. Please provide: baseURL, model. ' +
				'See: https://alibaba.github.io/page-agent/docs/features/models'
		)
	}

	return {
		baseURL: config.baseURL,
		model: config.model,
		apiKey: config.apiKey || '',
		temperature: config.temperature ?? DEFAULT_TEMPERATURE,
		maxRetries: config.maxRetries ?? LLM_MAX_RETRIES,
		disableNamedToolChoice: config.disableNamedToolChoice ?? false,
		customFetch: (config.customFetch ?? fetch).bind(globalThis),
	}
}

/**
 * Create LLM client based on model name prefix
 *
 * Rules:
 * - model starts with 'jiutian/' → JiutianClient (prefix is stripped before API call)
 * - otherwise → OpenAIClient (default)
 *
 * @example
 * createLLMClient({ model: 'jiutian/jiutian-lan-comv3', ... })  // JiutianClient, calls API with 'jiutian-lan-comv3'
 * createLLMClient({ model: 'gpt-4', ... })                      // OpenAIClient
 */
export function createLLMClient(config: LLMConfig): LLMClient {
	const model = config.model.toLowerCase()

	// Simple prefix-based detection
	if (model.startsWith('jiutian/')) {
		return new JiutianClient(config as JiutianLLMConfig)
	}

	// Default to OpenAI compatible client
	return new OpenAIClient(parseLLMConfig(config))
}

export class LLM extends EventTarget {
	config: Required<LLMConfig>
	client: LLMClient

	constructor(config: LLMConfig) {
		super()
		this.config = parseLLMConfig(config)

		// Auto-detect and create appropriate client
		this.client = createLLMClient(config)
	}

	/**
	 * - call llm api *once*
	 * - invoke tool call *once*
	 * - return the result of the tool
	 */
	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		return await withRetry(
			async () => {
				// in case user aborted before invoking
				if (abortSignal.aborted) throw new Error('AbortError')

				const result = await this.client.invoke(messages, tools, abortSignal, options)

				return result
			},
			// retry settings
			{
				maxRetries: this.config.maxRetries,
				onRetry: (attempt: number) => {
					this.dispatchEvent(
						new CustomEvent('retry', { detail: { attempt, maxAttempts: this.config.maxRetries } })
					)
				},
				onError: (error: Error) => {
					this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
				},
			}
		)
	}
}

async function withRetry<T>(
	fn: () => Promise<T>,
	settings: {
		maxRetries: number
		onRetry: (attempt: number) => void
		onError: (error: Error) => void
	}
): Promise<T> {
	let attempt = 0
	let lastError: Error | null = null
	while (attempt <= settings.maxRetries) {
		if (attempt > 0) {
			settings.onRetry(attempt)
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		try {
			return await fn()
		} catch (error: unknown) {
			// do not retry if aborted by user
			if ((error as any)?.rawError?.name === 'AbortError') throw error

			console.error(error)
			settings.onError(error as Error)

			// do not retry if error is not retryable (InvokeError)
			if (error instanceof InvokeError && !error.retryable) throw error

			lastError = error as Error
			attempt++

			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	throw lastError!
}
