// 模型目录：两套来源（网关 / 上游）归一化成同一份内部结构，再映射成 magpie 模型。
//
// 免费与倍率的判定依据（不自己发明）：
//   - 上游/网关的 theosPerRequest == "0"  → 免费（magpie 的 free: true）
//   - 其它 theosPerRequest 数值           → magpie 的 rate（一次请求消耗的点数倍率）
//   - magpie 里 rate: 0 表示“没有倍率”，不是免费，所以免费必须用 free: true 表达

import { CATALOG_TTL_MS, FALLBACK_MODELS } from "./constants.mjs";
import { formatNumber, isZeroCost, toNumber } from "./util.mjs";

/** 读取对象里可能存在的两套命名（上游 camelCase / 网关 deepai snake_case）。 */
function pickMeta(raw) {
  const deepai = raw?.deepai && typeof raw.deepai === "object" ? raw.deepai : null;
  if (deepai) {
    return {
      name: String(deepai.name ?? raw?.name ?? raw?.id ?? ""),
      reasoning: Boolean(deepai.reasoning),
      input: Array.isArray(deepai.input) ? deepai.input : ["text"],
      contextWindow: toNumber(deepai.context_window, 0),
      maxTokens: toNumber(deepai.max_tokens, 0),
      premier: Boolean(deepai.premier),
      theosPerRequest: String(deepai.theos_per_request ?? ""),
      freeFlag: typeof deepai.free === "boolean" ? deepai.free : undefined,
      api: String(deepai.api ?? ""),
    };
  }
  return {
    name: String(raw?.name ?? raw?.id ?? ""),
    reasoning: Boolean(raw?.reasoning),
    input: Array.isArray(raw?.input) ? raw.input : ["text"],
    contextWindow: toNumber(raw?.contextWindow, 0),
    maxTokens: toNumber(raw?.maxTokens, 0),
    premier: Boolean(raw?.premier),
    theosPerRequest: String(raw?.theosPerRequest ?? ""),
    freeFlag: undefined,
    api: String(raw?.api ?? ""),
  };
}

/** 归一化一个目录条目（两套来源都接受）。 */
export function normalizeRawModel(raw) {
  const meta = pickMeta(raw);
  const id = String(raw?.id ?? "").trim();
  if (!id) return null;

  const isFree =
    meta.freeFlag !== undefined
      ? meta.freeFlag
      : isZeroCost(meta.theosPerRequest)
        ? true
        : meta.theosPerRequest === ""
          ? !meta.premier
          : false;

  const rate = !isFree ? toNumber(meta.theosPerRequest, 0) : 0;

  return {
    id,
    name: meta.name || id,
    reasoning: meta.reasoning,
    input: meta.input.length > 0 ? meta.input : ["text"],
    contextWindow: meta.contextWindow,
    maxTokens: meta.maxTokens,
    premier: meta.premier,
    theosPerRequest: meta.theosPerRequest,
    free: isFree,
    rate: rate > 0 ? rate : 0,
    responses: meta.api === "openai-responses",
  };
}

/** 上游 /deepai_code/models 的响应 → 归一化列表。 */
export function catalogFromDirect(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return dedupe(models.map(normalizeRawModel).filter(Boolean));
}

/** 网关 /v1/models 的响应（OpenAI list）→ 归一化列表。 */
export function catalogFromGateway(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return dedupe(data.map(normalizeRawModel).filter(Boolean));
}

function dedupe(models) {
  const seen = new Set();
  const out = [];
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/**
 * 内部模型 → magpie 模型对象。
 *
 * 同时给出 config 钩子风格（reasoning / tool_call / modalities）与
 * models 钩子风格（capabilities），多给字段无害，少给会丢能力。
 */
export function toMagpieModel(model, base = {}) {
  const hasImage = Array.isArray(model.input) && model.input.includes("image");
  const out = {
    ...base,
    id: model.id,
    name: model.name || model.id,
    limit: {
      context: model.contextWindow || base?.limit?.context || 0,
      // 上游目录一定有 maxTokens；万一缺了给一个保守值，避免 limit.output 为空
      output: model.maxTokens || base?.limit?.output || 4096,
    },
    reasoning: model.reasoning,
    tool_call: true,
    modalities: { input: hasImage ? ["text", "image"] : ["text"] },
    capabilities: {
      reasoning: model.reasoning,
      toolcall: true,
      attachment: hasImage,
      input: { text: true, image: hasImage },
    },
  };

  if (model.free) {
    out.free = true;
    delete out.rate;
  } else if (model.rate > 0) {
    out.rate = model.rate;
    delete out.free;
  }

  // 模型级 npm 覆盖：只有 Responses-only 的模型（如 gpt-6-astra）需要换 API。
  if (model.responses) {
    out.provider = { ...(base?.provider ?? {}), npm: "@ai-sdk/openai" };
  }

  return out;
}

/** 归一化列表 → { [id]: magpie 模型 }。 */
export function modelsFromCatalog(models, baseModels = {}) {
  const out = {};
  for (const model of models) {
    out[model.id] = toMagpieModel(model, baseModels?.[model.id] ?? {});
  }
  return out;
}

/** 兜底快照（同样走归一化，避免两套判定逻辑漂移）。 */
export const FALLBACK_CATALOG = FALLBACK_MODELS.map(normalizeRawModel).filter(Boolean);

export function fallbackModels(baseModels = {}) {
  return modelsFromCatalog(FALLBACK_CATALOG, baseModels);
}

/**
 * 目录缓存：成功才缓存，失败不缓存（下一次会重试）；
 * 缓存命中时不阻塞、不重复请求上游。
 */
export function createCatalogCache({ ttlMs = CATALOG_TTL_MS, now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    async get(key, fetcher, { force = false } = {}) {
      const hit = map.get(key);
      if (hit && !force && now() - hit.at < ttlMs) return hit.value;
      const value = await fetcher(); // 抛错就直接冒泡，不写入缓存
      map.set(key, { at: now(), value });
      return value;
    },
    peek(key) {
      return map.get(key)?.value;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

/** 给额度/展示用的简短目录摘要。 */
export function catalogSummary(models) {
  const free = models.filter((m) => m.free).length;
  return `${models.length} models (${free} free, ${models.length - free} premier)`;
}

export { formatNumber };
