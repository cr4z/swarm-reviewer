// Side-effect module: importing this registers every MVP provider adapter
// (spec.md Assumptions: Anthropic/Claude, OpenAI/ChatGPT, DeepSeek, Kimi/Moonshot AI).
import { registerProvider } from "./registry.js";
import { anthropicAdapter } from "./anthropic.js";
import { openaiAdapter } from "./openai.js";
import { deepseekAdapter } from "./deepseek.js";
import { kimiAdapter } from "./kimi.js";

registerProvider(anthropicAdapter);
registerProvider(openaiAdapter);
registerProvider(deepseekAdapter);
registerProvider(kimiAdapter);
