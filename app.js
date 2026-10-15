"use strict";

const MODEL_OPTIONS = [
  { id: "deepseek/deepseek-v4-flash-0731", label: "deepseek-v4-flash Loading…" },
  { id: "deepseek/deepseek-v4-pro-0813", label: "deepseek-v4-pro Loading…" },
  { id: "z-ai/glm-5.3", label: "glm-5.3 Loading…" },
  { id: "z-ai/glm-5.3-flash", label: "glm-5.3-flash Loading…", supportsImages: true },
  { id: "minimax/minimax-m3", label: "minimax-m3 Loading…" },
  { id: "moonshotai/kimi-k2.7-code", label: "kimi-k2.7-code Loading…" },
  { id: "moonshotai/kimi-k3", label: "kimi-k3 Loading…" },
  { id: "qwen/qwen3.8-2.4t-a95b", label: "qwen3.8-2.4t-a95b Loading…" },
  { id: "qwen/qwen3.8-flash-next", label: "qwen3.8-flash-next Loading…" },
];

async function loadModelOptions() {
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
    const tags = [];
    if (modelInfo.supports_vision) tags.push("Bilder");
    if (pricePerMillionTokens < 1) tags.push("günstig");
    else if (pricePerMillionTokens > 10) tags.push("teuer");
    if (maxInputTokens >= 1024 * 1024) tags.push("langer Kontext");

    let context;
    if (maxInputTokens >= 1024 * 1024) context = `${Math.round(maxInputTokens / (1024 * 1024))}M`;
    else if (maxInputTokens >= 1024) context = `${Math.round(maxInputTokens / 1024)}k`;
    else context = String(maxInputTokens);

    model.label = tags.length > 0 ? `${name} (${tags.join(", ")})` : name;
    model.supportsImages = Boolean(modelInfo.supports_vision);
    model.info = `$${pricePerMillionTokens.toFixed(2)}/1M tokens, ${context} context`;
  }

  renderModelOptions();
}

function renderModelOptions() {
  elements.model.replaceChildren();
  for (const model of MODEL_OPTIONS) {
    elements.model.append(new Option(model.label, model.id));
  }
  elements.model.value = MODEL_OPTIONS[0].id;
  updateModelControls();
}

function updateModelControls() {
  const model = MODEL_OPTIONS.find((entry) => entry.id === elements.model.value);
  elements.modelInfo.textContent = model?.info || "";

  const supportsImages = Boolean(model?.supportsImages);
  elements.image.disabled = !supportsImages;
  elements.image.title = supportsImages
    ? "Attach one or more images"
    : "Image uploads are not available for the selected model";
  elements.pdf.disabled = !supportsImages;
  elements.pdf.title = supportsImages
    ? "Upload a PDF; each page will be rasterized to a JPG on the proxy"
    : "Image uploads are not available for the selected model";
}



const elements = {
  model: document.getElementById("model"),
  modelInfo: document.getElementById("model-info"),
  thinking: document.getElementById("thinking"),
  image: document.getElementById("image"),
  imageSelection: document.getElementById("image-selection"),
  pdf: document.getElementById("pdf"),
  pdfStatus: document.getElementById("pdf-status"),
  pdfDpi: document.getElementById("pdf-dpi"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("send")
};

let messages = [];
let activeRequest = null;
let attachments = []; // { name, url } pairs; url is always a data URL

function createBubble(role) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;

  const label = document.createElement("div");
  label.className = "bubble-label";
  label.textContent = role.toUpperCase();

  bubble.appendChild(label);
  return bubble;
}

function createUserBubble(content) {
  const bubble = createBubble("user");
  const body = document.createElement("div");

  for (const item of content) {
    switch (item.type) {
      case "text": {
        const text = document.createElement("div");
        text.textContent = item.text;
        body.appendChild(text);
        break;
      }
      case "image_url": {
        const link = imagePreviewLink(item.image_url.url, "🖼️ View image", "right");
        body.appendChild(link);
        break;
      }
    }
  }

  bubble.appendChild(body);
  elements.messages.appendChild(bubble);
  bubble.scrollIntoView({ behavior: "smooth", block: "end" });
}

// browsers don't like navigating to data URLs, so also show the image in-place.
function imagePreviewLink(dataUrlImage, text, imagePopupSide) {
  const link = document.createElement("a");
  link.href = dataUrlImage;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `attachment-chip ${imagePopupSide}`;
  link.textContent = text;

  const img = document.createElement("img");
  img.src = dataUrlImage;

  link.appendChild(img);
  return link;
}

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "✓";
    setTimeout(() => { button.textContent = "📋"; }, 1200);
  } catch (error) {
    console.error("Copy failed:", error);
    button.textContent = "❌";
  }
}

function createAssistantBubble() {
  const bubble = createBubble("assistant");

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "copy-btn";
  copyBtn.textContent = "📋";
  copyBtn.title = "Copy response";
  copyBtn.setAttribute("aria-label", "Copy response");

  const thinking = document.createElement("div");
  thinking.className = "thinking";

  const status = document.createElement("div");
  status.className = "assistant-status visible";
  status.innerHTML = '<span class="dot"></span><span>Thinking…</span>';

  const content = document.createElement("div");

  copyBtn.addEventListener("click", () => copyToClipboard(content.textContent, copyBtn));

  bubble.append(copyBtn, thinking, status, content);
  elements.messages.appendChild(bubble);
  bubble.scrollIntoView({ behavior: "smooth", block: "end" });

  return { bubble, copyBtn, thinking, content, status };
}


function updateAssistantBubble(assistantBubble, { content, thinking, loading }) {
  assistantBubble.thinking.textContent = thinking;
  assistantBubble.thinking.classList.toggle("visible", Boolean(thinking));

  assistantBubble.content.textContent = content;

  assistantBubble.status.classList.toggle("visible", loading);
  assistantBubble.status.innerHTML = loading ? '<span class="dot"></span><span>Thinking…</span>' : '';

  const hasContent = content && String(content).trim().length > 0;
  assistantBubble.copyBtn.classList.toggle("visible", hasContent);
}

function updateImageSelectionSummary() {
  if (attachments.length === 0) {
    elements.imageSelection.hidden = true;
    return;
  }

  elements.imageSelection.hidden = false;
  elements.imageSelection.replaceChildren();

  attachments.forEach((attachment, index) => {
    if (index > 0) {
      elements.imageSelection.appendChild(document.createTextNode(", "));
    }
    elements.imageSelection.appendChild(imagePreviewLink(attachment.url, `🖼️ ${attachment.name}`, "left"));
  });
}

// The file picker is just an import control: read the files once, append, reset.
async function handleImagesSelected() {
  const files = Array.from(elements.image.files || []);
  const picked = await Promise.all(files.map(async (file) => ({ name: file.name, url: await fileToDataUrl(file) })));
  attachments.push(...picked);
  elements.image.value = "";
  updateImageSelectionSummary();
}

function clearSelectedImages() {
  elements.image.value = "";
  attachments = [];
  updateImageSelectionSummary();
}

function setPdfStatus(text, loading = false) {
  elements.pdfStatus.replaceChildren(text ?? "");
  if (loading) {
    const node = document.createElement("span");
    node.className = "dot";
    elements.pdfStatus.prepend(node);
  }
  elements.pdfStatus.hidden = !text;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePdfSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const modelConfig = MODEL_OPTIONS.find((entry) => entry.id === elements.model.value);
  if (!modelConfig?.supportsImages) {
    alert("The selected model does not support image uploads.");
    elements.pdf.value = "";
    return;
  }

  setPdfStatus(`Rasterizing ${file.name}…`, true);
  elements.pdf.disabled = true;
  elements.send.disabled = true;

  try {
    const dpi = parseInt(elements.pdfDpi.value, 10) || 72;
    console.log("[ephyprompt]", "PDF rasterization request. DPI: ", dpi, "X-Filename: ", file.name);
    const response = await fetch("/rasterize-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": file.name,
        "X-DPI": String(dpi)
      },
      body: file
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    }

    const result = await response.json();
    const pages = Array.isArray(result?.pages) ? result.pages : [];
    if (pages.length === 0) {
      throw new Error("Proxy returned no pages");
    }

    attachments.push(...pages);
    updateImageSelectionSummary();

    setPdfStatus(`Added ${pages.length} page${pages.length === 1 ? "" : "s"} from ${file.name} (at ${dpi} DPI)`);
    console.log("[ephyprompt]", "PDF rasterized", { filename: file.name, pageCount: pages.length });
  } catch (error) {
    console.log("[ephyprompt]", "PDF rasterization failed", { error: error.message });
    setPdfStatus(`Failed to rasterize ${file.name}: ${error.message}`);
    alert(`Failed to rasterize PDF: ${error.message}`);
  } finally {
    elements.pdf.value = "";
    elements.pdf.disabled = false;
    elements.send.disabled = false;
  }
}

function setSendButtonReceiving(receiving) {
  elements.send.textContent = receiving ? "Stop" : "Send";
}

function processSSEBuffer(buffer, processData) {
  const chunks = buffer.split("\n\n");
  const remainder = chunks.pop() || "";

  for (const chunk of chunks) {
    let dataLine = "";
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("data:")) dataLine = trimmed.slice(5).trim();
    }
    if (!dataLine) continue;
    if (dataLine === "[DONE]") {
      console.log("[ephyprompt]", "Stream finished");
      continue;
    }
    try {
      processData(JSON.parse(dataLine));
    } catch (error) {
      console.log("[ephyprompt]", "Failed to parse SSE payload", { dataLine, error: error.message });
    }
  }
  return remainder;
}

async function send(event) {
  event?.preventDefault();
  if (activeRequest) {
    activeRequest.abort();
    return;
  }

  const text = elements.input.value.trim();
  const model = elements.model.value;
  const modelConfig = MODEL_OPTIONS.find((entry) => entry.id === model);

  if (attachments.length > 0 && !modelConfig?.supportsImages) {
    alert("The selected model does not support image uploads.");
    return;
  }

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    content.push({
      type: "text",
      text: `Filename: ${attachment.name}`
    });
    content.push({
      type: "image_url",
      image_url: { url: attachment.url }
    });
  }

  messages.push({ role: "user", content });
  console.log("[ephyprompt]", "Sending chat request", { model, messageCount: messages.length, imageCount: attachments.length });
  elements.input.value = "";
  clearSelectedImages();
  createUserBubble(content);


  const assistantBubble = createAssistantBubble();

  let assistantText = "";
  let assistantThinking = "";
  activeRequest = new AbortController();
  setSendButtonReceiving(true);
  try {
    let response = await fetch("/v1/chat/completions", {
      method: "POST",
      signal: activeRequest.signal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model,
        messages: messages,
        stream: true,
        chat_template_kwargs: { enable_thinking: elements.thinking.checked, thinking: elements.thinking.checked }
      })
    });
    console.log("[ephyprompt]", "Received response", { status: response.status, ok: response.ok, contentType: response.headers.get("content-type") });

    if (!response.ok) {
      throw new Error(`Fetch Request failed: HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.headers.get("content-type").toLowerCase().startsWith("text/event-stream")) {
      throw new Error(`Expected SSE, got ${response.headers.get("content-type") || "missing Content-Type"}`);
    }
    if (!response.body) {
      throw new Error("response body is not readable");
    }


    function processReceived(data) {
      const delta = data.choices?.[0]?.delta;
      if (delta?.content) assistantText += delta.content;
      const thinkingDelta = delta?.reasoning_content ?? delta?.reasoning;
      if (thinkingDelta) assistantThinking += thinkingDelta;
      updateAssistantBubble(assistantBubble, { content: assistantText, thinking: assistantThinking, loading: true });
    }

    let sseBuffer = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer = processSSEBuffer(sseBuffer + decoder.decode(value, { stream: true }), processReceived);
    }
    processSSEBuffer(sseBuffer + decoder.decode(), processReceived);

    const reply = assistantText || "(no response)";
    updateAssistantBubble(assistantBubble, { content: reply, thinking: assistantThinking, loading: false });
    messages.push({ role: "assistant", content: reply });
    console.log("[ephyprompt]", "Chat response completed");
  } catch (error) {
    let errMsg = `${assistantText} [ERROR] ERROR: ${error.message}`;
    updateAssistantBubble(assistantBubble, { content: errMsg, thinking: assistantThinking, loading: false });
    messages.push({ role: "assistant", content: errMsg });
    console.log("[ephyprompt]", "Chat response failed");
  } finally {
    activeRequest = null;
    setSendButtonReceiving(false);
    assistantBubble.bubble.scrollIntoView({ behavior: "auto", block: "end" });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  clearSelectedImages(); // clear browser trying to restore upload (firefox)

  renderModelOptions();
  loadModelOptions();
  elements.model.addEventListener("change", updateModelControls);
  elements.image.addEventListener("change", handleImagesSelected);
  elements.pdf.addEventListener("change", handlePdfSelected);
  elements.composer.addEventListener("submit", send);
  elements.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!activeRequest && !elements.send.disabled) {
        send(event);
      }
    }
  });
});