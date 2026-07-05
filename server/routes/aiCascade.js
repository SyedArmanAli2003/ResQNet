/**
 * aiCascade.js — Unified multi-provider AI model cascade for ResQNet
 *
 * Priority order:
 *   1. NVIDIA NIM  — DeepSeek V4 Flash (best reasoning, primary)
 *   2. OpenRouter  — Llama 3.3 70b Instruct:free
 *   3. OpenRouter  — GPT-OSS 120b:free
 *
 * Usage:
 *   const { callAI, AI_MODELS } = require('./aiCascade');
 *   const result = await callAI(messages, { preferredModel: 'nim-deepseek', parseJson: true });
 */

const config = require('../config');

// ── Model registry ────────────────────────────────────────────────────────────
const AI_MODELS = [
  {
    id: 'nim-deepseek',
    label: 'DeepSeek V4 Flash (NIM)',
    provider: 'nvidia',
    model: 'deepseek-ai/deepseek-v4-flash',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    apiKey: () => config.nvidiaApiKey,
    temperature: 0.2,
    maxTokens: 1024,
    extra: { chat_template_kwargs: { thinking: false } },
    badge: 'DS·NIM',
    badgeColor: '#00d4ff',
  },
  {
    id: 'llama-3.3-70b',
    label: 'Llama 3.3 70b Instruct (OpenRouter)',
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: () => config.openRouterApiKey,
    temperature: 0.1,
    maxTokens: 512,
    badge: 'L3.3',
    badgeColor: '#a855f7',
  },
  {
    id: 'gpt-oss-120b',
    label: 'Mistral 7b Instruct (OpenRouter)',
    provider: 'openrouter',
    model: 'mistralai/mistral-7b-instruct:free',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: () => config.openRouterApiKey,
    temperature: 0.1,
    maxTokens: 512,
    badge: 'M7b',
    badgeColor: '#10b981',
  },
];

// ── Core OpenAI-compat call ───────────────────────────────────────────────────
async function callModel(modelCfg, messages) {
  const apiKey = modelCfg.apiKey();
  if (!apiKey) throw new Error(`No API key for ${modelCfg.label}`);

  const body = {
    model: modelCfg.model,
    messages,
    temperature: modelCfg.temperature,
    max_tokens: modelCfg.maxTokens,
  };

  // NVIDIA NIM — pass extra_body
  if (modelCfg.provider === 'nvidia' && modelCfg.extra) {
    Object.assign(body, modelCfg.extra);
  }

  // OpenRouter — request JSON mode
  if (modelCfg.provider === 'openrouter') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${modelCfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://resqnet-gdsc-2026.netlify.app',
      'X-Title': 'ResQNet',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),  // 20s hard timeout
  });

  const data = await res.json();
  if (data.error) throw new Error(`${data.error.code || res.status}: ${data.error.message}`);

  return data.choices?.[0]?.message?.content || null;
}

// ── JSON extractor ─────────────────────────────────────────────────────────
function extractJson(text, arrayMode = false) {
  if (!text) return null;
  const clean = text.replace(/```json|```/g, '').trim();
  if (arrayMode) {
    const s = clean.indexOf('['), e = clean.lastIndexOf(']');
    if (s === -1 || e === -1) return null;
    return JSON.parse(clean.substring(s, e + 1));
  }
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  return JSON.parse(clean.substring(s, e + 1));
}

// ── Cascade caller ────────────────────────────────────────────────────────────
/**
 * @param {Array} messages  - OpenAI-style messages array
 * @param {Object} opts
 * @param {string} [opts.preferredModel] - model id to try first (falls through on failure)
 * @param {boolean} [opts.parseJson]     - extract JSON from response
 * @param {boolean} [opts.arrayMode]     - extract JSON array instead of object
 * @returns {Promise<{result: any, modelUsed: string, badge: string, badgeColor: string}|null>}
 */
async function callAI(messages, opts = {}) {
  const { preferredModel, parseJson = false, arrayMode = false } = opts;

  // Build ordered list: preferred first, then rest in default priority
  let ordered = [...AI_MODELS];
  if (preferredModel && preferredModel !== 'auto') {
    const idx = ordered.findIndex(m => m.id === preferredModel);
    if (idx > 0) {
      const [pref] = ordered.splice(idx, 1);
      ordered.unshift(pref);
    }
  }

  for (const model of ordered) {
    try {
      console.log(`[AI] Trying ${model.label}...`);
      const text = await callModel(model, messages);
      if (!text) { console.warn(`[AI] ${model.label} returned empty`); continue; }

      let result = parseJson ? extractJson(text, arrayMode) : text;
      if (parseJson && !result) { console.warn(`[AI] ${model.label} JSON parse failed`); continue; }

      if (parseJson && result) result.modelUsed = model.label;
      console.log(`[AI] ✓ ${model.label}`);
      return { result, modelUsed: model.label, badge: model.badge, badgeColor: model.badgeColor };
    } catch (err) {
      console.warn(`[AI] ${model.label} error: ${err.message}`);
    }
  }

  console.error('[AI] All models failed, falling back to rules engine');
  return null;
}

module.exports = { callAI, AI_MODELS };
