# Strands Agents TypeScript SDK — verified API surface

Transcribed from the **installed** `@strands-agents/sdk@1.16.0` (`node_modules/@strands-agents/sdk/dist/src/**/*.d.ts` and its bundled `README.md`), not from memory or web docs.

**Everything in `lib/agent/` is written against this file.** If a signature here is wrong, fix it here first, then fix the code.

Node.js 20+ required. Package is ESM (`"type": "module"`).

---

## 1. Agent

```ts
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({ systemPrompt: 'You are a helpful assistant.' })
const result = await agent.invoke('What is the square root of 1764?')
```

`invoke(args: InvokeArgs, options?: InvokeOptions): Promise<AgentResult>`
`stream(args: InvokeArgs, options?: InvokeOptions): AsyncGenerator<AgentStreamEvent>`

### `AgentConfig` — the fields we care about

| Field | Type | Note |
|---|---|---|
| `model` | `Model` | Defaults to `BedrockModel` |
| `tools` | `ToolList` | Nested arrays are flattened automatically |
| `systemPrompt` | `SystemPrompt \| SystemPromptData` | |
| `structuredOutputSchema` | `z.ZodSchema` | **Set at agent level, not per-call** |
| `printer` | `boolean` | **Defaults to `true` — prints to console.** Set `false` in route handlers |
| `conversationManager` | `ConversationManager` | Defaults to sliding window, 40 messages |
| `retryStrategy` | `RetryStrategy \| RetryStrategy[] \| null` | Default is exponential backoff. `null` disables |
| `name` / `description` / `id` | `string` | `id` defaults to `"agent"` |

Also available and relevant later: `plugins`, `interventions`, `sessionManager`, `memoryManager`, `backgroundTasks`, `contextManager`.

> **Gotcha — `printer` defaults to true.** Every agent constructed inside a route handler must pass `printer: false` or it writes the whole reasoning stream to the serverless function log on every invocation.

---

## 2. Tools — `tool()` with a Zod schema

```ts
import { Agent, tool } from '@strands-agents/sdk'
import { z } from 'zod'

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a specific location.',
  inputSchema: z.object({
    location: z.string().describe('The city and state, e.g., San Francisco, CA'),
  }),
  callback: (input) => {
    // input is fully typed from the Zod schema
    return `The weather in ${input.location} is 72°F and sunny.`
  },
})

const agent = new Agent({ tools: [weatherTool] })
```

`ZodToolConfig`:

| Field | Type | Note |
|---|---|---|
| `name` | `string` | Required |
| `description` | `string?` | Optional in the type, but **always write one** — it's what the model routes on |
| `inputSchema` | `z.ZodType?` | Omitted or `z.void()` = tool takes no input |
| `callback` | `(input, context?) => TReturn \| Promise<TReturn> \| AsyncGenerator` | **Return value must be JSON-serializable** |

`.describe()` on each Zod field becomes the parameter description the model sees. Use it on every field — it is the cheapest accuracy win available.

There is a second overload, `tool(config: FunctionToolConfig)`, taking a raw JSON schema. We don't use it.

### Calling a tool from your own code

`tool()` returns an `InvokableTool<TInput, TReturn>`, which has a direct
`invoke(input, context?): Promise<TReturn>` (`tools/tool.d.ts` line 165). It runs
the Zod validation, unwraps async generators and returns the raw value rather
than a `ToolResult`, and lets errors throw instead of wrapping them.

`lib/agent/core.ts` uses it for the observe, retrieve, act and log steps, so the
five tools in `architecture.md` §3.1 are the single implementation of those
steps whether the model calls them or the loop does.

---

## 3. Bedrock model provider

```ts
import { Agent, BedrockModel } from '@strands-agents/sdk'

const model = new BedrockModel({
  region: 'us-east-1',
  modelId: 'global.anthropic.claude-sonnet-4-6',
  maxTokens: 4096,
  temperature: 0.7,
})

const agent = new Agent({ model })
```

`BedrockModelOptions extends BedrockModelConfig extends BaseModelConfig`:

- From `BaseModelConfig`: `modelId`, `maxTokens`, `temperature`, `topP`, `contextWindowLimit`
- From `BedrockModelConfig`: `stopSequences`, `cacheConfig`, `stream`, `guardrailConfig`, `additionalRequestFields`, `additionalArgs`, `includeToolResultStatus`, `useNativeTokenCount`
- From `BedrockModelOptions`: `region`, `clientConfig` (a `BedrockRuntimeClientConfig`), `apiKey` (bearer token instead of SigV4)

**Default model id is `global.anthropic.claude-sonnet-4-6`.** The README notes this requires model access enabled for Claude Sonnet 4.6 in your region. Do not assume the account has it — read `BEDROCK_MODEL_ID` from env and pass it explicitly.

Auth is standard AWS SigV4 via the default credential chain (`@aws-sdk/client-bedrock-runtime` is a real dependency), or `apiKey` for bearer tokens.

---

## 4. Structured output — the decide step

Schema goes on the **agent**, result comes back on `AgentResult.structuredOutput`:

```ts
const PersonSchema = z.object({
  name: z.string().describe('Name of the person'),
  age: z.number().describe('Age of the person'),
})

const agent = new Agent({ structuredOutputSchema: PersonSchema })
const result = await agent.invoke('John Smith is 30')

result.structuredOutput.name // typed
```

The agent **automatically retries with validation feedback** when the model returns something that fails the schema. If it ultimately fails it throws `StructuredOutputError`:

```ts
import { StructuredOutputError } from '@strands-agents/sdk'
```

This is the free reliability `architecture.md` §3.1 is counting on for the decide step.

### It composes with regular tools

Structured output is not a separate mode. The agent registers a synthetic tool
named `strands_structured_output` whose input schema is your Zod schema
(`tools/structured-output-tool.js`), so a `structuredOutputSchema` agent can also
be given normal `tools` — the model may call those first, and the run ends when
it calls the structured output tool. If the model replies with plain text
instead, the agent drops that turn and forces the tool on the next cycle; only
if it refuses again does it throw `StructuredOutputError` (`agent/agent.js`
~line 1139).

`InvokeOptions.structuredOutputSchema` also exists as a per-call override of the
agent-level schema. We use the agent-level one.

> **Gotcha — no `.refine()` in a schema the model sees.** Both tool input schemas
> and the structured output schema go through `zodSchemaToJsonSchema`, which is a
> thin wrapper over `z.toJSONSchema` (`tools/zod-utils.js`). Zod 4 throws on
> anything it cannot represent in JSON Schema, and a refinement is top of that
> list. To constrain a value to a known set — volunteer ids, say — build a
> `z.enum(idsArray)` at call time. It survives the conversion, and an invalid id
> then triggers the automatic validation retry instead of reaching the database.

### `AgentResult` fields

| Field | Type | Note |
|---|---|---|
| `stopReason` | `StopReason` | |
| `lastMessage` | `Message` | |
| `structuredOutput` | `z.output<z.ZodType>` | Present when a schema was configured |
| `metrics` | `AgentMetrics` | Token usage, cycle counts, tool stats, model latency |
| `traces` | `AgentTrace[]` | Timing and hierarchy inside the agent loop |
| `invocationState` | `InvocationState` | Always defined, `{}` by default |
| `interrupts` | `Interrupt[]` | When `stopReason === 'interrupt'` |

`traces` and `metrics` are the reasoning-trace demo asset — log them into `events` per `architecture.md` §3.1 step 5.

---

## 5. Errors worth catching

Exported from the package root: `ModelError`, `ContextWindowOverflowError`, `MaxTokensError`, `JsonValidationError`, `ConcurrentInvocationError`, `ModelThrottledError`, `ToolValidationError`, `StructuredOutputError`, `ToolNotFoundError`, `DefaultNotConfiguredError`, `StorageError`.

`ModelThrottledError` matters on a live demo — Bedrock throttles. The default retry strategy handles it, but `architecture.md` principle 4 ("degrade, don't break") means the loop must log and continue rather than throw on camera.

---

## 6. Install gotchas — hit on day 1, do not re-derive

**`npm install @strands-agents/sdk` pulls hundreds of MB you do not need.**

The package declares **23 peer dependencies** — `openai`, `@google/genai`, `@anthropic-ai/sdk`, `@cedar-policy/cedar-wasm`, the whole OpenTelemetry stack, `express` — and npm 7+ installs peers automatically. It also declares `optionalDependencies: { '@tobilu/qmd': '^2.8.0' }`, whose own optional chain reaches **`node-llama-cpp` with CUDA and Vulkan binaries**.

Actual runtime dependencies are small: `@aws-sdk/client-bedrock-runtime`, `@smithy/fetch-http-handler`, `@types/json-schema`, `uuid`, `yaml`.

`.npmrc` in this repo pins `legacy-peer-deps=true` (skips the peer avalanche) plus long fetch timeouts. Install with `--omit=optional` to skip the llama binaries:

```bash
npm install --omit=optional
```

`zod` is a peer dep, so it must be installed explicitly — it is a direct dependency in `package.json`.

### Two peer deps are NOT optional in practice

Despite being declared as peers, these are imported **statically on the module load path** of the package's Node entry, so the app will not build or run without them:

| Package | Imported by | Why |
|---|---|---|
| `@modelcontextprotocol/sdk` | `dist/src/mcp/config.node.js` | MCP transports, loaded eagerly by `index.node.js` |
| `@opentelemetry/api` | `dist/src/telemetry/tracer.js` | `AgentTrace` is a root export |

Both are installed as direct dependencies. Every other peer (`openai`, `@google/genai`, `@anthropic-ai/sdk`, `express`, `@cedar-policy/*`, `@a2a-js/sdk`, the OpenTelemetry exporters) sits behind a subpath export or an unreachable module and is genuinely not needed.

### Next.js must not bundle the SDK

`next.config.ts` sets:

```ts
serverExternalPackages: ["@strands-agents/sdk"]
```

Without it, Turbopack statically resolves every branch of the SDK — including the MCP transports and `@aws-sdk/client-s3` in the context offloader — and the build fails with `Module not found` for packages the app never calls. Marking it external means Node `require`s it from `node_modules` at runtime and those branches are never touched.

Verified: `next build` succeeds and `/api/spike` compiles as a dynamic route.

---

## 7. Not used (available if needed)

`Graph` and `Swarm` multi-agent orchestration, `McpClient`, `MemoryManager` (SDK-native memory — we implement our own per `architecture.md` §3.2/§3.3), `SessionManager`, `Sandbox`, hooks (`BeforeToolCallEvent`, `AfterModelCallEvent`, …), middleware, `ModelRouter` with fallback.

The SDK's own `MemoryManager` is deliberately **not** used: the whole point of the project is the event-log + reflection architecture from Park et al., and it needs to be visible and inspectable in our own tables.

---

## 8. Seeded scenario — the signal the reflection must find

`lib/seed.ts` is deterministic (fixed LCG seed `20260901`). Reseed with
`POST /api/dev/seed`. Tune the reflection prompt against these facts:

| Slot | Minimum | Weekly attendance, oldest to newest |
|---|---|---|
| **Saturday 9am** | 6 | **9, 9, 7 → 5, 4, 3, 2, 3** |
| Saturday 1pm | 4 | 4, 6, 8, 7, 4, 6, 5, 4 |
| Tuesday 5pm | 4 | 3, 5, 4, 6, 5, 5, 5, 5 |
| Thursday 5pm | 4 | 6, 7, 4, 4, 5, 5, 5, 4 |

**The planted pattern:** Saturday 9am is healthy for three weeks, then short
every week for five. **Maria Ocampo** and **James Whitfield** — its two most
reliable regulars — last appear 2026-07-18, exactly where the slide starts.
Remaining regulars then turn out slightly less as the shift gets thinner.

Every other slot holds at or above its minimum, so naming Saturday 9am is a real
finding rather than the only thing available to say. The upcoming Saturday 9am is
seeded short by three, which is what the agent loop has to act on.

A correct reflection names the slot, the trend, and ideally the two departed
regulars, with `source_event_ids` pointing at the `shift_short` and
`shift_completed` rows that prove it.
