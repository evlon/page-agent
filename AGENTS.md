# Instructions for Coding Assistants

## Project Overview

This is a **monorepo** with npm workspaces:

- **Page Agent** (`packages/page-agent/`) - Main entry with built-in UI Panel, published as `page-agent` on npm
- **Extension** (`packages/extension/`) - Browser extension (WXT + React) WIP
- **Website** (`packages/website/`) - React docs and landing page. **When working on website, follow `packages/website/AGENTS.md`**

Internal packages:

- **Core** (`packages/core/`) - PageAgentCore without UI (npm: `@page-agent/core`)
- **LLMs** (`packages/llms/`) - LLM client with reflection-before-action mental model
- **Page Controller** (`packages/page-controller/`) - DOM operations and visual feedback (SimulatorMask), independent of LLM
- **UI** (`packages/ui/`) - Panel and i18n. Decoupled from PageAgent
- **MCP** (`packages/mcp/`) - Model Context Protocol server

## Development Commands

```bash
npm start                    # Start website dev server
npm run dev:demo             # Start demo dev server (page-agent)
npm run dev:ext              # Start extension dev server
npm run build                # Build all packages
npm run build:libs           # Build all libraries only
npm run build:website        # Build website only
npm run build:ext            # Build extension and zip
npm run lint                 # ESLint with TypeScript strict rules
npm run cleanup              # Remove all dist/ directories
```

### Running Lint on Specific Files

```bash
npx eslint packages/core/src/PageAgentCore.ts    # Lint single file
npx eslint packages/llms/src/                    # Lint directory
```

### Testing

No automated tests exist yet. Manual testing via demo:

```bash
npm run dev:demo   # Start demo at localhost:5173
```

## Code Style Guidelines

### Formatting (Prettier)

- **Indentation**: Tabs (useTabs: true)
- **Quotes**: Single quotes
- **Semicolons**: No semicolons
- **Print width**: 100 characters
- **Trailing commas**: ES5 (commas where valid in ES5)

Run formatter: `npx prettier --write <file>`

### Import Ordering

Imports are auto-sorted by `@trivago/prettier-plugin-sort-imports`:

1. Third-party modules (react, zod, etc.)
2. Package aliases (`@/...` - non-CSS)
3. Relative imports (`./...`, `../...` - non-CSS)
4. CSS imports last

### TypeScript Conventions

- **Target**: ES2024 with strict mode enabled
- **Module**: ESNext with bundler resolution
- **Explicit types** for all exported/public APIs
- **Type exports**: Use `export type * from './types'`
- **Zod v4**: Import from `zod/v4` for schema validation

```typescript
import * as z from 'zod/v4'
```

### Naming Conventions

- **Classes**: PascalCase (`PageAgentCore`, `LLM`)
- **Interfaces/Types**: PascalCase (`AgentConfig`, `BrowserState`)
- **Functions/Methods**: camelCase (`execute`, `getSimplifiedHTML`)
- **Private fields**: `#` prefix (`#status`, `#llm`, `#abortController`)
- **Constants**: SCREAMING_SNAKE_CASE for true constants, camelCase otherwise
- **Event types**: Discriminated union with `type` field

### Error Handling

- **Throw errors** for programmer errors and invalid states
- **Return structured results** for operation outcomes (`ActionResult { success, message }`)
- **Do not hide errors** - make them visible and actionable
- **Use `assert()` utility** for invariants that should never fail

```typescript
// Good: Operation result
const result = await this.pageController.clickElement(index)
return result.message

// Good: Assertion for invariants
assert(tool, `Tool ${toolName} not found`)
```

### Class Design

- **Extend EventTarget** for classes that emit events
- **Async public methods** for all DOM/network operations
- **Lifecycle methods**: `dispose()` for cleanup
- **Event naming**: `statuschange`, `historychange`, `activity`, `dispose`

### Comments and Documentation

- **JSDoc for public APIs**: Description, `@param`, `@returns`, `@example`
- **Inline comments**: Use `//` for brief explanations, `@note`/`@todo` tags
- **All code and comments in English**
- **Copyright header** for new source files

```typescript
/**
 * AI agent for browser automation.
 * @param config - Agent configuration
 * @example
 * const agent = new PageAgentCore({ pageController, baseURL, model })
 */
```

### Module Boundaries

- **Page Agent**: Imports from `@page-agent/core`, `@page-agent/ui`
- **Core**: Imports from `@page-agent/llms`, `@page-agent/page-controller`
- **LLMs**: No page-agent dependency
- **Page Controller**: No LLM dependency
- **UI**: Decoupled via `PanelAgentAdapter` interface

## Architecture

### Monorepo Structure

```
packages/
├── core/                    # npm: "@page-agent/core" - Core agent logic (headless)
├── page-agent/              # npm: "page-agent" - Entry class with UI
├── website/                 # @page-agent/website (private)
├── llms/                    # @page-agent/llms
├── extension/               # Browser extension (WXT + React)
├── page-controller/         # @page-agent/page-controller
├── ui/                      # @page-agent/ui
└── mcp/                     # MCP server
```

`workspaces` in root `package.json` must be in topological order (dependencies before dependents).

### PageController Communication

All communication is async and isolated:

```typescript
// PageAgent delegates DOM operations to PageController
await this.pageController.updateTree()
await this.pageController.clickElement(index)

// PageController exposes state via async methods
const simplifiedHTML = await this.pageController.getSimplifiedHTML()
```

### DOM Pipeline

1. **DOM Extraction**: Live DOM -> `FlatDomTree` via `page-controller/src/dom/dom_tree/`
2. **Dehydration**: DOM tree -> simplified text for LLM
3. **LLM Processing**: AI returns action plans (page-agent)
4. **Indexed Operations**: PageAgent calls PageController by element index

## Key Files Reference

| Package | File | Description |
|---------|------|-------------|
| page-agent | `src/PageAgent.ts` | Main class with UI, extends PageAgentCore |
| core | `src/PageAgentCore.ts` | Core agent class without UI |
| core | `src/tools/index.ts` | Tool definitions calling PageController |
| core | `src/types.ts` | All type definitions |
| llms | `src/index.ts` | LLM class with retry logic |
| llms | `src/OpenAIClient.ts` | OpenAI-compatible client |
| page-controller | `src/PageController.ts` | Main controller with optional mask |
| page-controller | `src/actions.ts` | Element interactions |

## Adding New Features

### New Agent Tool

1. Implement in `packages/core/src/tools/index.ts`
2. If tool needs DOM ops, add method to PageController first
3. Tool calls `this.pageController.methodName()` for DOM interactions
4. Export type from `packages/core/src/types.ts` if needed

### New PageController Action

1. Add implementation in `packages/page-controller/src/actions.ts`
2. Expose via async method in `PageController.ts`
3. Return `{ success: boolean, message: string }`

## Philosophy

- **Traceability over success rate**: Predictable behavior is more important than high success rate
- **Visible errors**: Do not hide errors or risks - they are valuable feedback
- **Code quality**: Every change should improve the codebase, not just implement features
- **Explicit over implicit**: Clear, readable code with proper typing