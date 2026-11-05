"use strict";

import { loadModelOptions, MODEL_OPTIONS } from "./model-discovery.js";

const elements = {
  model: document.getElementById("model"),
  modelInfo: document.getElementById("model-info"),
  thinking: document.getElementById("thinking"),
  textAttachments: document.getElementById("text-attachments"),
  textSelection: document.getElementById("text-selection"),
  imageAttachments: document.getElementById("image-attachments"),
  imageSelection: document.getElementById("image-selection"),
  pdfAttachments: document.getElementById("pdf-attachments"),
  pdfStatus: document.getElementById("pdf-status"),
  pdfWidth: document.getElementById("pdf-width"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  input: document.getElementById("input"),
  send: document.getElementById("send")
};


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
  elements.imageAttachments.disabled = !supportsImages;
  elements.imageAttachments.title = supportsImages ? "Attach one or more images" : "Image uploads are not available for the selected model";
  elements.pdfAttachments.disabled = !supportsImages;
  elements.pdfAttachments.title = supportsImages ? "Upload a PDF; each page will be rasterized to a PNG on the proxy" : "Image uploads are not available for the selected model";
}


let messages = [];
let activeRequest = null;
let textAttachments = []; // { name, content } pairs;
let imageAttachments = []; // { name, url } pairs; url is always a data URL

function withHiddenMetadata(obj) {
  Object.defineProperty(obj, "_hidden_only_render_abbreviated", {
    value: true,
    enumerable: false
  });
  return obj;
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

function createInputBubble(role, content) {
  const bubble = createBubble(role);
  const body = document.createElement("div");

  for (const item of content) {
    switch (true) {
      case item.type === "text" && item._hidden_only_render_abbreviated: {
        const text = document.createElement("div");
        text.className = "attachment-chip";
        text.textContent = item.text.substring(0, 80) + (item.text.length > 80 ? "..." : "");
        body.appendChild(text);
        break;
      }
      case item.type == "text": {
        const text = document.createElement("div");
        text.textContent = item.text;
        body.appendChild(text);
        break;
      }
      case item.type == "image_url": {
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

function updateTextSelectionSummary() {
  if (textAttachments.length === 0) {
    elements.textSelection.hidden = true;
    return;
  }

  elements.textSelection.hidden = false;
  elements.textSelection.replaceChildren();

  textAttachments.forEach((attachment, index) => {
    if (index > 0) {
      elements.textSelection.appendChild(document.createTextNode(", "));
    }
    const chip = document.createElement("div");
    chip.className = `attachment-chip`;
    chip.textContent = `📄 ${attachment.name}`;

    elements.textSelection.appendChild(chip);
  });
}

function updateImageSelectionSummary() {
  if (imageAttachments.length === 0) {
    elements.imageSelection.hidden = true;
    return;
  }

  elements.imageSelection.hidden = false;
  elements.imageSelection.replaceChildren();

  imageAttachments.forEach((attachment, index) => {
    if (index > 0) {
      elements.imageSelection.appendChild(document.createTextNode(", "));
    }
    elements.imageSelection.appendChild(imagePreviewLink(attachment.url, `🖼️ ${attachment.name}`, "left"));
  });
}

// The file picker is just an import control: read the files once, append, reset.
async function handleTextSelected() {
  const files = Array.from(elements.textAttachments.files || []);
  const picked = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() }))); // may contain gibberish on non-text files.
  textAttachments.push(...picked);
  elements.textAttachments.value = "";
  updateTextSelectionSummary();
}

async function handleImagesSelected() {
  const files = Array.from(elements.imageAttachments.files || []);
  const picked = await Promise.all(files.map(async (file) => ({ name: file.name, url: await fileToDataUrl(file) })));
  imageAttachments.push(...picked);
  elements.imageAttachments.value = "";
  updateImageSelectionSummary();
}

function clearSelectedAttachments() {
  elements.textAttachments.value = "";
  textAttachments = [];
  updateTextSelectionSummary();
  elements.imageAttachments.value = "";
  imageAttachments = [];
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
    elements.pdfAttachments.value = "";
    return;
  }

  setPdfStatus(`Rasterizing ${file.name}…`, true);
  elements.pdfAttachments.disabled = true;
  elements.send.disabled = true;

  try {
    const width = elements.pdfWidth.value;
    console.log("[ephyprompt]", "PDF rasterization request. Width:", width, "X-Filename:", file.name);
    const response = await fetch("/rasterize-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": file.name,
        "X-Width": String(width)
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

    imageAttachments.push(...pages);
    updateImageSelectionSummary();

    setPdfStatus(`Added ${pages.length} page${pages.length === 1 ? "" : "s"} from ${file.name} (at ${width} px)`);
    console.log("[ephyprompt]", "PDF rasterized", { filename: file.name, pageCount: pages.length });
  } catch (error) {
    console.log("[ephyprompt]", "PDF rasterization failed", { error: error.message });
    setPdfStatus(`Failed to rasterize ${file.name}: ${error.message}`);
    alert(`Failed to rasterize PDF: ${error.message}`);
  } finally {
    elements.pdfAttachments.value = "";
    elements.pdfAttachments.disabled = false;
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

  if (imageAttachments.length > 0 && !modelConfig?.supportsImages) {
    alert("The selected model does not support image uploads.");
    return;
  }

  const content = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const attachment of textAttachments) {
    content.push({
      type: "text",
      text: `Filename: ${attachment.name}`
    });
    content.push(withHiddenMetadata({
      type: "text",
      text: attachment.content
    }));
  }

  for (const attachment of imageAttachments) {
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
  console.log("[ephyprompt]", "Sending chat request", { model, messageCount: messages.length, textAttachmentCount: textAttachments.length, imageCount: imageAttachments.length });
  elements.input.value = "";
  clearSelectedAttachments();
  createInputBubble("user", content);


  const assistantBubble = createAssistantBubble();

  let assistantText = "";
  let assistantThinking = "";
  let lastChunk = null; // the most recent parsed SSE chunk; normally, the final one has API metadata, like usage information.
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
      lastChunk = data;

      const delta = data.choices?.[0]?.delta;
      if (delta?.content) assistantText += delta.content;
      const thinkingDelta = delta?.reasoning_content ?? delta?.reasoning;
      if (thinkingDelta) assistantThinking += thinkingDelta;

      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason) {
        console.log("[ephyprompt]", "Stream finish reason", finishReason);
        if (finishReason !== "stop") {
          console.warn("[ephyprompt]", "Stream did not finish normally", { finishReason });
        }
      }

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

    console.log("[ephyprompt]", "Final stream chunk", lastChunk);

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
  clearSelectedAttachments(); // clear browser trying to restore upload (firefox)

  renderModelOptions();
  loadModelOptions().then(() => { renderModelOptions(); });
  elements.model.addEventListener("change", updateModelControls);
  elements.textAttachments.addEventListener("change", handleTextSelected);
  elements.imageAttachments.addEventListener("change", handleImagesSelected);
  elements.pdfAttachments.addEventListener("change", handlePdfSelected);
  elements.composer.addEventListener("submit", send);
  elements.input.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!activeRequest && !elements.send.disabled) {
        send(event);
      }
    }
  });

  const startupMessages = window.EPHYPROMPT_STARTUP_MESSAGES ?? [];
  messages.push(...structuredClone(startupMessages));
  for (const message of messages) {
    console.log("[ephyprompt]", "Rendering startup message", { role: message.role, content: message.content });
    switch (message.role) {
      case "system":
        createInputBubble("system", message.content);
        break;
      case "user":
        createInputBubble("user", message.content);
        break;
      case "assistant":
        alert("Assistant prefill not supported.");
        break;
    }
  }
});