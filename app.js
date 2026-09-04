"use strict";

const MODEL_OPTIONS = [
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash (günstig)", supportsImages: false, info: "$0.30/1M tokens, 1M context" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", supportsImages: false, info: "$3.50/1M tokens, 1M context" },
  { id: "z-ai/glm-5.3", label: "Z-AI GLM-5.3", supportsImages: false, info: "$1.75/1M tokens, 1M context" },
  { id: "z-ai/glm-5v-turbo", label: "Z-AI GLM-5v Turbo (bilder)", supportsImages: true, info: "$4.00/1M tokens, 198k context" },
  { id: "z-ai/glm-5.3-flash", label: "Z-AI GLM-5.3 Flash (bilder)", supportsImages: true, info: "$0.50/1M tokens, 1M context" },
  { id: "minimax/minimax-m3", label: "Minimax M3 (bilder)", supportsImages: true, info: "$2.00/1M tokens, 1M context" },
  { id: "moonshotai/kimi-k2.6", label: "Moonshot kimi K2.6 (bilder)", supportsImages: true, info: "$4.00/1M tokens, 256k context" },
  { id: "moonshotai/kimi-k3", label: "Moonshot kimi K3 (bilder, teuer!!)", supportsImages: true, info: "$15.00/1M tokens, 1M context" },
  { id: "qwen/qwen3.8-2.4t-a95b", label: "Qwen3.8-Max", supportsImages: false, info: "$6.00/1M tokens, 256k context" },
  { id: "qwen/qwen3.8-flash-next", label: "Qwen3.8-Flash-Next (Bilder)", supportsImages: true, info: "$0.50/1M tokens, 256k context" },
  { id: "qwen/qwen3.5-122b-a10b", label: "Qwen 3.5 (bilder)", supportsImages: true, info: "$3.50/1M tokens, 256k context" }
];

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

function populateModelOptions() {
  elements.model.replaceChildren();
  for (const model of MODEL_OPTIONS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    elements.model.appendChild(option);
  }
  elements.model.value = MODEL_OPTIONS[0].id;
  updateImageControls();
}

function updateModelInfo() {
  const model = MODEL_OPTIONS.find((entry) => entry.id === elements.model.value);
  elements.modelInfo.textContent = model?.info || "";
}

function updateImageControls() {
  const model = MODEL_OPTIONS.find((entry) => entry.id === elements.model.value);
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
    if (item.type === "text") {
      const text = document.createElement("div");
      text.textContent = item.text;
      body.appendChild(text);
    }

    if (item.type === "image_url") {
      const link = imagePreviewLink(item.image_url.url, "🖼️ View image", "right")
      body.appendChild(link);
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

  assistantBubble.bubble.scrollIntoView({ behavior: "auto", block: "end" });
}

function updateImageSelectionSummary() {
  if (attachments.length === 0) {
    elements.imageSelection.textContent = "No images selected";
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

  let response;
  let assistantText = "";
  let assistantThinking = "";
  activeRequest = new AbortController();
  setSendButtonReceiving(true);
  try {
    response = await fetch("/chat", {
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
    if (!response.body) {
      throw new Error("response body is not readable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    function processReceived(data) {
      const delta = data.choices?.[0]?.delta;
      if (delta?.content) assistantText += delta.content;
      const thinkingDelta = delta?.reasoning_content ?? delta?.reasoning;
      if (thinkingDelta) assistantThinking += thinkingDelta;
      updateAssistantBubble(assistantBubble, { content: assistantText, thinking: assistantThinking, loading: true });
    }

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
    updateAssistantBubble(assistantBubble, { content: `${assistantText} [ERROR] ERROR: ${error.message}`, thinking: assistantThinking, loading: false });
  } finally {
    activeRequest = null;
    setSendButtonReceiving(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  clearSelectedImages(); // clear browser trying to restore upload (firefox)

  populateModelOptions();
  updateModelInfo();
  elements.model.addEventListener("change", () => {
    updateImageControls();
    updateModelInfo();
  });
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