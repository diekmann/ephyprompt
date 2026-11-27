"use strict";

// Fallback while /v1/models is loading, and in case it cannot be fetched at all.
export const MODEL_OPTIONS = [
  { id: "deepseek/deepseek-v4.1-flash", label: "deepseek/deepseek-v4.1-flash Loading…", supportsImages: true },
];

async function fetchJsonArray(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload?.data)) {
    throw new Error(`unexpected response shape from ${path}`);
  }
  return payload.data;
}

// Enumerates the available models via /v1/models and populates MODEL_OPTIONS.
// On failure, the fallback entry in MODEL_OPTIONS is kept.
async function loadModels() {
  let entries;
  try {
    entries = await fetchJsonArray("/v1/models");

    const models = [];
    for (const entry of entries) { // model ids can appear more than once; keep the first entry per id.
      if (!entry?.id || models.some((model) => model.id === entry.id)) {
        continue;
      }
      models.push({ id: entry.id, label: `${entry.id} Loading…`, supportsImages: false });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) {
      console.warn("[model-discovery]", "/v1/models returned no models; keeping fallback options");
      return;
    }
    MODEL_OPTIONS.length = 0;
    MODEL_OPTIONS.push(...models);
    console.log("[model-discovery]", "Models loaded", { modelCount: models.length });
  } catch (error) {
    console.error("[model-discovery]", "Failed to load models", { error: error.message });
    alert(error);
  }
}

export async function loadModelOptions() {
  await loadModels();

  const models = new Map();
  try {
    // TODO: /v1/model/info should be enough, no need for /v1/models call.
    for (const entry of await fetchJsonArray("/v1/model/info")) { // model_name can appear more than once; keep the first entry per name.
      if (entry?.model_name && !models.has(entry.model_name)) {
        models.set(entry.model_name, entry.model_info ?? {});
      }
    }
    console.log("[model-discovery]", "Model info loaded", { modelCount: models.size });
  } catch (error) {
    console.error("[model-discovery]", "Failed to load model info", { error: error.message });
    alert(error);
  }

  const kept = MODEL_OPTIONS.filter(model => {
    const modelInfo = models.get(model.id);
    if (modelInfo?.mode !== "chat") {
      console.log(`[model-discovery] Filtering out non-chat model: ${model.id}`, modelInfo ?? "(No model info available)");
      return false;
    }
    return true;
  });
  MODEL_OPTIONS.length = 0;
  MODEL_OPTIONS.push(...kept);

  for (const model of MODEL_OPTIONS) {
    const modelInfo = models.get(model.id);
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

    model.label = tags.length > 0 ? `${model.id} (${tags.join(", ")})` : model.id;
    model.supportsImages = Boolean(modelInfo.supports_vision);
    model.info = `$${pricePerMillionTokens.toFixed(2)}/1M tokens, ${context} context`;
  }
}
