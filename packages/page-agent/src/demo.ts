/**
 * IIFE demo entry - auto-initializes with built-in demo API for testing
 */
import { PageAgent, type PageAgentConfig } from './PageAgent'

// Clean up existing instances to prevent multiple injections from bookmarklet
if (window.pageAgent) {
	window.pageAgent.dispose()
}

// Mount to global window object
window.PageAgent = PageAgent

console.log('🚀 page-agent.js loaded!')

const DEMO_MODEL = 'qwen3.5-plus'
const DEMO_BASE_URL = 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run'
const DEMO_API_KEY = 'NA'

// Capture currentScript BEFORE setTimeout (it becomes null in async callback)
const scriptElement = document.currentScript as HTMLScriptElement | null
const scriptSrc = scriptElement?.src || null

// in case document.x is not ready yet
setTimeout(() => {
	let config: PageAgentConfig

	if (scriptSrc) {
		console.log('🚀 page-agent.js detected script src:', scriptSrc)
		const url = new URL(scriptSrc)
		const model = url.searchParams.get('model') || DEMO_MODEL
		const baseURL = url.searchParams.get('baseURL') || DEMO_BASE_URL
		const apiKey = url.searchParams.get('apiKey') || DEMO_API_KEY
		const language = (url.searchParams.get('lang') as 'zh-CN' | 'en-US') || 'zh-CN'
		config = { model, baseURL, apiKey, language }
	} else {
		console.log('🚀 page-agent.js no script src detected, using default demo config')
		config = {
			model: import.meta.env.LLM_MODEL_NAME ? import.meta.env.LLM_MODEL_NAME : DEMO_MODEL,
			baseURL: import.meta.env.LLM_BASE_URL ? import.meta.env.LLM_BASE_URL : DEMO_BASE_URL,
			apiKey: import.meta.env.LLM_API_KEY ? import.meta.env.LLM_API_KEY : DEMO_API_KEY,
		}
	}

	// Create agent
	window.pageAgent = new PageAgent(config)
	window.pageAgent.panel.show()

	console.log('🚀 page-agent.js initialized with config:', window.pageAgent.config)
})
