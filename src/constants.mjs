// 常量与兜底数据。
//
// 上游事实来源：DeepAI Code 桌面端 / api.deepai.org 的实际行为，
// 网络实测见 PROTOCOL.md。这里只放“实现要照抄”的常量，不放逻辑。

export const PROVIDER = "deepaicode";
export const VERSION = "0.2.0";

/** 直连上游默认地址。 */
export const DEFAULT_BASE_ORIGIN = "https://api.deepai.org";
/** 直连模式在 origin 下的路径前缀。 */
export const DIRECT_MODEL_BASE = "/deepai_code";

/** Theos 计费车道版本；上游不认会回 426。 */
export const DEFAULT_LANE_VERSION = "2";

export const HEADER_KEY = "Api-Key";
export const HEADER_LANE = "X-DeepAI-Code-Theos";
export const HEADER_MACHINE = "X-DeepAI-Code-Machine";
export const HEADER_AFFINITY = "X-Session-Affinity";

/** 桌面端凭据文件名（按优先级）。 */
export const CREDENTIAL_FILES = ["deepai-account.bin", "deepai-account-user-managed.bin"];
/** 相对 base 目录的 secrets 候选。 */
export const SECRET_SUBDIRS = [["userdata", "secrets"], ["secrets"], ["dev", "secrets"]];

export const CATALOG_TTL_MS = 60_000;
/** Retry-After 的夹取上限（秒），与上游行为对齐。 */
export const RETRY_AFTER_CAP_S = 30;
/** 非流式 JSON 响应体的读取上限。 */
export const MAX_JSON_BYTES = 1 << 20;

/**
 * 上游模型目录不可用时的兜底快照（2026-11-06 实测，14 个）。
 * 只用于“没登录 / 目录请求失败”时仍然有模型可选；正常路径永远以动态目录为准。
 */
export const FALLBACK_MODELS = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "mimo-2.6-flash", name: "MiMo 2.6 Flash", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "solar-mini-4", name: "Solar Mini 4", reasoning: true, input: ["text"], contextWindow: 524288, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "gpt-6-luna", name: "GPT-6 Luna", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "mimo-2.6-pro", name: "MiMo 2.6 Pro", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "crouton-alpha", name: "Crouton Alpha", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: false, theosPerRequest: "0" },
  { id: "deepai-cyber", name: "DeepAI Cyber", reasoning: true, input: ["text"], contextWindow: 65536, maxTokens: 8192, premier: false, theosPerRequest: "0" },
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: true, theosPerRequest: "10" },
  { id: "glm-5.3", name: "GLM 5.3", reasoning: true, input: ["text"], contextWindow: 1048576, maxTokens: 131072, premier: true, theosPerRequest: "3" },
  { id: "kimi-k3", name: "Kimi K3", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: true, theosPerRequest: "3" },
  { id: "claude-opus-5-5", name: "Claude Opus 5.5", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072, premier: true, theosPerRequest: "15" },
  { id: "claude-fable-5-1", name: "Claude Fable 5.1", reasoning: true, input: ["text", "image"], contextWindow: 1000000, maxTokens: 131072, premier: true, theosPerRequest: "25" },
  { id: "gpt-6-astra", name: "GPT-6 Astra", reasoning: true, input: ["text", "image"], contextWindow: 1048576, maxTokens: 131072, premier: true, theosPerRequest: "50", api: "openai-responses" },
];

/** 模型目录快照的采集日期（写进 PROTOCOL.md / README，避免被当成实时数据）。 */
export const FALLBACK_SNAPSHOT_DATE = "2026-11-06";

export const DEFAULT_OPTIONS = {
  baseOrigin: DEFAULT_BASE_ORIGIN,
  laneVersion: DEFAULT_LANE_VERSION,
  /** 界面语言：zh | en */
  lang: "zh",
  /** 桌面端凭据目录（留空自动探测） */
  secretDir: "",
  /** 调试日志（只记录字段名，不记录值） */
  debug: false,
};
