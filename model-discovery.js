"use strict";


// TODO: use /v1/models to enumerate models.
export const MODEL_OPTIONS = [
  { id: "deepseek/deepseek-v4.1-flash", label: "deepseek-v4.1-flash Loading…", supportsImages: true },
  { id: "deepseek/deepseek-v4-flash-0731", label: "deepseek-v4-flash Loading…" },
  { id: "deepseek/deepseek-v4-pro-0813", label: "deepseek-v4-pro Loading…" },
  { id: "z-ai/glm-5.3", label: "glm-5.3 Loading…" },
  { id: "z-ai/glm-5.3-flash", label: "glm-5.3-flash Loading…" },
  { id: "minimax/minimax-m3.1-flash", label: "minimax-m3.1-flash Loading…" },
  { id: "moonshotai/kimi-k3.1-pro", label: "kimi-k3.1-pro Loading…" },
  { id: "moonshotai/kimi-k3", label: "kimi-k3 Loading…" },
  { id: "qwen/qwen3.8-2.4t-a95b", label: "qwen3.8-2.4t-a95b Loading…" },
  { id: "qwen/qwen3.8-27b", label: "qwen3.8-27b Loading…" },
];

export async function loadModelOptions() {
  const models = new Map();
  try {
    const response = await fetch("/v1/model/info");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) {
      throw new Error("unexpected response shape from /v1/model/info");
    }
    for (const entry of payload.data) { //  model_name can appear more than once; keep the first entry per name.
      if (entry?.model_name && !models.has(entry.model_name)) {
        models.set(entry.model_name, entry.model_info ?? {});
      }
    }
    console.log("[ephyprompt]", "Model info loaded", { modelCount: models.size });
  } catch (error) {
    console.error("[ephyprompt]", "Failed to load model info", { error: error.message });
  }

  for (const model of MODEL_OPTIONS) {
    const modelInfo = models.get(model.id);
    const name = model.id.split("/").pop();
    if (!modelInfo) {
      model.label = `${name} (❌ Modell wird nicht mehr unterstützt)`;
      continue;
    }
    const pricePerMillionTokens = modelInfo.output_cost_per_token * 1000000;
    const maxInputTokens = modelInfo.max_input_tokens;
    const tags = [
      ...(modelInfo.supports_vision ? ["Bilder"] : []),
      ...(pricePerMillionTokens < 1 ? ["günstig"] : pricePerMillionTokens > 10 ? ["teuer"] : []),
      ...(maxInputTokens >= 1024 ** 2 ? ["langer Kontext"] : [])
    ];

    let context;
    if (maxInputTokens >= 1024 * 1024) {
      context = `${Math.round(maxInputTokens / (1024 * 1024))}M`;
    } else if (maxInputTokens >= 1024) {
      context = `${Math.round(maxInputTokens / 1024)}k`;
    } else {
      context = String(maxInputTokens);
    }

    model.label = tags.length > 0 ? `${name} (${tags.join(", ")})` : name;
    model.supportsImages = Boolean(modelInfo.supports_vision);
    model.info = `$${pricePerMillionTokens.toFixed(2)}/1M tokens, ${context} context`;
  }
}

