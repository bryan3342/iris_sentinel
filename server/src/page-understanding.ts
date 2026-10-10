import type { AccessEnv } from './access';
import type { AgentEnv } from './routes/agent-token/index';
/** Worker settings: Worker secrets and variables, or server/.dev.vars locally. */
export interface Env extends AccessEnv, AgentEnv {
  GEMINI_API_KEY?: string; GEMINI_MODEL?: string; EXTENSION_ORIGIN?: string;
  ENABLE_PAGE_UNDERSTANDING?: string; PAGE_CONTENT_APPROVED?: string;
}
