/**
 * Jiutian LLM Client
 *
 * Client for China Mobile Jiutian (九天) LLM API
 *
 * Supported models with tool calling (from docs):
 * - jiutian-lan-comv3: ⭐ Recommended, actually calls jiutian-lan-236b-w8a8
 * - jiutian-lan-35b: 128K context, long documents
 * - jiutian-lan-236b-w8a8: MOE architecture, text understanding & agent
 * - deepseek-r1: 671B, deep reasoning, math/code
 * - qwen3-moe-235b: 235B (22B active), fast inference
 * - glm-5-fp8: 744B, top programming model
 * - kimi-k2-5-thinking: Complex reasoning, thinking with tools
 *
 * Temperature range: 0-1.0 (per docs)
 *
 * @note Model name prefix 'jiutian/' is stripped before API calls.
 *       e.g., 'jiutian/jiutian-lan-comv3' → API receives 'jiutian-lan-comv3'
 */
import * as z from 'zod/v4'

import { InvokeError, InvokeErrorType } from './errors'
import type { InvokeOptions, InvokeResult, LLMClient, LLMConfig, Message, Tool } from './types'
import { zodToOpenAITool } from './utils'

export interface JiutianLLMConfig extends LLMConfig {
	/**
	 * Force higher temperature for Jiutian models
	 * Jiutian needs temperature >= 1.0 for reliable tool calling
	 * @default 1.0
	 */
	temperature?: number
}

/**
 * Client for Jiutian (九天) LLM API
 *
 * @example
 * ```typescript
 * const client = new JiutianClient({
 *   baseURL: 'https://jiutian.10086.cn/largemodel/moma/api/v3',
 *   apiKey: 'your-token',
 *   model: 'jiutian-lan-comv3'
 * })
 * ```
 */
export class JiutianClient implements LLMClient {
	config: Required<JiutianLLMConfig>
	private fetch: typeof globalThis.fetch

	constructor(config: JiutianLLMConfig) {
		// Strip 'jiutian/' prefix from model name if present
		// This prefix is only for client detection, not sent to API
		const model = config.model.toLowerCase().startsWith('jiutian/')
			? config.model.slice('jiutian/'.length)
			: config.model

		this.config = {
			...config,
			// Use stripped model name
			model,
			// Jiutian temperature range: 0-1.0 (doc says 1.0 max)
			// Use 0.9 for reliable tool calling while staying in valid range
			temperature: Math.min(config.temperature ?? 0.9, 1.0),
			maxRetries: config.maxRetries ?? 2,
			apiKey: config.apiKey || '',
		}

		// Support custom fetch (e.g., for proxy)
		this.fetch = config.customFetch ? config.customFetch.bind(globalThis) : fetch.bind(globalThis)
	}

	async invoke(
		messages: Message[],
		tools: Record<string, Tool>,
		abortSignal?: AbortSignal,
		options?: InvokeOptions
	): Promise<InvokeResult> {
		// 1. Convert tools to OpenAI format
		const openaiTools = Object.entries(tools).map(([name, t]) => zodToOpenAITool(name, t))

		// 2. Build request body
		let toolChoice: unknown = 'required'
		// Jiutian doesn't support named tool choice with object format
		if (options?.toolChoiceName) {
			// Just use 'required' - Jiutian will choose the right tool
			toolChoice = 'required'
		}

		const requestBody: Record<string, unknown> = {
			model: this.config.model,
			temperature: this.config.temperature,
			messages,
			tools: openaiTools,
			parallel_tool_calls: false,
			tool_choice: toolChoice,
		}

		// 3. Call API
		let response: Response
		try {
			response = await this.fetch(`${this.config.baseURL}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(this.config.apiKey && { Authorization: `Bearer ${this.config.apiKey}` }),
				},
				body: JSON.stringify(requestBody),
				signal: abortSignal,
			})
		} catch (error: unknown) {
			const isAbortError = (error as any)?.name === 'AbortError'
			const errorMessage = isAbortError ? 'Network request aborted' : 'Network request failed'
			if (!isAbortError) console.error(error)
			throw new InvokeError(InvokeErrorType.NETWORK_ERROR, errorMessage, error)
		}

		// 4. Handle HTTP errors
		if (!response.ok) {
			let errorData: unknown
			try {
				const errorText = await response.text()
				if (errorText) errorData = JSON.parse(errorText)
			} catch {
				// Ignore JSON parse errors
			}
			const errorMessage =
				(errorData as { message?: string })?.message ||
				(errorData as { error?: { message?: string } })?.error?.message ||
				response.statusText

			if (response.status === 401 || response.status === 403) {
				throw new InvokeError(
					InvokeErrorType.AUTH_ERROR,
					`Authentication failed: ${errorMessage}`,
					errorData
				)
			}
			if (response.status === 429) {
				throw new InvokeError(
					InvokeErrorType.RATE_LIMIT,
					`Rate limit exceeded: ${errorMessage}`,
					errorData
				)
			}
			if (response.status >= 500) {
				throw new InvokeError(
					InvokeErrorType.SERVER_ERROR,
					`Server error: ${errorMessage}`,
					errorData
				)
			}
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`HTTP ${response.status}: ${errorMessage}`,
				errorData
			)
		}

		// 5. Parse response
		let data: any
		try {
			const responseText = await response.text()
			if (!responseText || responseText.trim() === '') {
				throw new InvokeError(
					InvokeErrorType.SERVER_ERROR,
					'Empty response body from Jiutian API',
					undefined
				)
			}
			data = JSON.parse(responseText)
		} catch (error: unknown) {
			if (error instanceof InvokeError) throw error
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`Failed to parse Jiutian response: ${(error as Error).message}`,
				error
			)
		}

		const choice = data.choices?.[0]
		if (!choice) {
			throw new InvokeError(InvokeErrorType.UNKNOWN, 'No choices in response', data)
		}

		// 6. Check finish_reason
		switch (choice.finish_reason) {
			case 'tool_calls':
			case 'function_call':
			case 'stop':
				break
			case 'length':
				throw new InvokeError(
					InvokeErrorType.CONTEXT_LENGTH,
					'Response truncated: max tokens reached',
					undefined,
					data
				)
			case 'content_filter':
				throw new InvokeError(
					InvokeErrorType.CONTENT_FILTER,
					'Content filtered by safety system',
					undefined,
					data
				)
			default:
				throw new InvokeError(
					InvokeErrorType.UNKNOWN,
					`Unexpected finish_reason: ${choice.finish_reason}`,
					undefined,
					data
				)
		}

		// 7. Get tool call from response
		// Note: Jiutian sometimes returns finish_reason: "tool_calls" with empty tool_calls array
		// Retry automatically if this happens
		const toolCallName = choice?.message?.tool_calls?.[0]?.function?.name

		if (!toolCallName) {
			// Jiutian edge case: returned finish_reason "tool_calls" but no tool_calls
			// This is a known issue with Jiutian models - retry with higher temperature
			throw new InvokeError(
				InvokeErrorType.NO_TOOL_CALL,
				'Jiutian returned finish_reason "tool_calls" but no tool_calls in response. This is a model limitation.',
				undefined,
				data
			)
		}

		const tool = tools[toolCallName]
		if (!tool) {
			throw new InvokeError(
				InvokeErrorType.UNKNOWN,
				`Tool "${toolCallName}" not found in tools`,
				undefined,
				data
			)
		}

		// 8. Extract and parse tool arguments
		const argString = choice.message?.tool_calls?.[0]?.function?.arguments
		if (!argString) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'No tool call arguments found',
				undefined,
				data
			)
		}

		let parsedArgs: unknown
		try {
			parsedArgs = JSON.parse(argString)
		} catch (error) {
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Failed to parse tool arguments as JSON',
				error,
				data
			)
		}

		// 9. Validate with schema
		const validation = tool.inputSchema.safeParse(parsedArgs)
		if (!validation.success) {
			console.error(z.prettifyError(validation.error))
			throw new InvokeError(
				InvokeErrorType.INVALID_TOOL_ARGS,
				'Tool arguments validation failed',
				validation.error,
				data
			)
		}
		const toolInput = validation.data

		// 10. Execute tool
		let toolResult: unknown
		try {
			toolResult = await tool.execute(toolInput)
		} catch (e) {
			throw new InvokeError(
				InvokeErrorType.TOOL_EXECUTION_ERROR,
				`Tool execution failed: ${(e as Error).message}`,
				e,
				data
			)
		}

		// 11. Return result
		return {
			toolCall: {
				name: toolCallName,
				args: toolInput,
			},
			toolResult,
			usage: {
				promptTokens: data.usage?.prompt_tokens ?? 0,
				completionTokens: data.usage?.completion_tokens ?? 0,
				totalTokens: data.usage?.total_tokens ?? 0,
				cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
				reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
			},
			rawResponse: data,
			rawRequest: requestBody,
		}
	}
}
