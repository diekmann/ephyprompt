"use strict";

import { loadModelOptions, MODEL_OPTIONS } from "./model-discovery.js";
import { llmChat } from "./llm-api.js";

const elements = {
  model: document.getElementById("model"),
  modelInfo: document.getElementById("model-info"),
  thinking: document.getElementById("thinking"),
  textAttachments: document.getElementById("text-attachments"),
  imageAttachments: document.getElementById("image-attachments"),
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
  elements.pdfAttachments.title = supportsImages ? "Upload a PDF; each page will be rasterized to a PNG" : "Image uploads are not available for the selected model";
}


let messages = [];
let pendingContent = []; // content that has been added but not yet sent.

let activeRequest = null;

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
        const link = imagePreviewLink(item.image_url.url, "🖼️ View image");
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
function imagePreviewLink(dataUrlImage, text) {
  const link = document.createElement("a");
  link.href = dataUrlImage;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `attachment-chip`;
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

function thinkingAnimation(status) {
  status.replaceChildren();
  const dot = document.createElement("span");
  dot.className = "dot";
  const text = document.createElement("span");
  text.textContent = "Thinking…";
  status.append(dot, text);
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
  thinkingAnimation(status);

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
  if (loading) {
    thinkingAnimation(assistantBubble.status);
  } else {
    assistantBubble.status.replaceChildren();
  }

  const hasContent = content && String(content).trim().length > 0;
  assistantBubble.copyBtn.classList.toggle("visible", hasContent);
}


// The file picker is just an import control: read the files once, append, reset.
async function handleTextSelected() {
  const files = Array.from(elements.textAttachments.files || []);
  const picked = await Promise.all(files.map(async (file) => ({ name: file.name, content: await file.text() }))); // may contain gibberish on non-text files.
  const content = [];
  for (const attachment of picked) {
    content.push({
      type: "text",
      text: `Filename: ${attachment.name}`
    });
    content.push(withHiddenMetadata({
      type: "text",
      text: attachment.content
    }));
  }
  createInputBubble("user", content);
  pendingContent.push(...content);
  elements.textAttachments.value = "";
}

async function handleImagesSelected() {
  const files = Array.from(elements.imageAttachments.files || []);
  const picked = await Promise.all(files.map(async (file) => ({ name: file.name, url: await fileToDataUrl(file) })));
  addImagesToPendingContent(picked);
  elements.imageAttachments.value = "";
}

function addImagesToPendingContent(nameDataURLPairs) {
  const content = [];
  for (const attachment of nameDataURLPairs) {
    content.push({
      type: "text",
      text: `Filename: ${attachment.name}`
    });
    content.push({
      type: "image_url",
      image_url: { url: attachment.url }
    });
  }
  createInputBubble("user", content);
  pendingContent.push(...content);
}

function clearSelectedAttachments() {
  elements.textAttachments.value = "";
  elements.imageAttachments.value = "";
  elements.pdfAttachments.value = "";
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

let pdfRasterizeWorker = null; // Lazy loading.
const trustedTypesPolicy = trustedTypes.createPolicy("pdf-worker", { createScriptURL: (url) => "pdf-rasterize-worker.js" });
async function rasterizePDFInWorker(arrayBuffer, filename, width) {
  if (!pdfRasterizeWorker) {
    pdfRasterizeWorker = new Worker(trustedTypesPolicy.createScriptURL(""), { type: "module" });
    await new Promise((resolve, reject) => {
      pdfRasterizeWorker.onmessage = () => resolve();
      pdfRasterizeWorker.onerror = (e) => reject(new Error(`PDF worker failed to load: ${e.error?.message ?? e.message}`));
    });
    console.log("[ephyprompt]", "pdfRasterizeWorker ready")
  }
  return new Promise((resolve, reject) => {
    pdfRasterizeWorker.onmessage = ({ data }) => resolve(data);
    pdfRasterizeWorker.onerror = (error) => reject(new Error(`PDF worker failed: ${error.message}`));
    pdfRasterizeWorker.postMessage({ arrayBuffer, filename, width }, [arrayBuffer]);
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
    console.log("[ephyprompt]", "PDF rasterization. Width:", elements.pdfWidth.value, "Filename:", file.name);
    const pdfAsDataURLs = await rasterizePDFInWorker(await file.arrayBuffer(), file.name, elements.pdfWidth.value)
    console.assert(Array.isArray(pdfAsDataURLs.pages), typeof (pdfAsDataURLs.pages))
    const pages = pdfAsDataURLs.pages;
    if (pages.length === 0) {
      throw new Error("rasterizePDFInWorker returned no pages");
    }

    addImagesToPendingContent(pages);

    setPdfStatus(`Added ${pages.length} page${pages.length === 1 ? "" : "s"} from ${file.name} (at ${elements.pdfWidth.value} px)`);
    console.log("[ephyprompt]", "PDF rasterized", { filename: file.name, pageCount: pages.length });
  } catch (error) {
    console.log("[ephyprompt]", "PDF rasterization failed", { error: error.message });
    alert(`Failed to rasterize PDF: ${error.message}`);
    setPdfStatus(`failed`, false);
  } finally {
    elements.pdfAttachments.value = "";
    elements.pdfAttachments.disabled = false;
    elements.send.disabled = false;
  }
}

function setSendButtonReceiving(receiving) {
  elements.send.textContent = receiving ? "Stop" : "Send";
}

async function send(event) {
  event?.preventDefault();
  if (activeRequest) {
    activeRequest.abort();
    return;
  }

  const textContent = [{
    type: "text",
    text: elements.input.value.trim()
  }];
  createInputBubble("user", textContent);
  pendingContent.push(...textContent);

  messages.push({ role: "user", content: [...pendingContent] });
  console.log("[ephyprompt]", "Sending chat request", { model: elements.model.value, messageCount: messages.length });

  pendingContent.length = 0;
  elements.input.value = "";
  clearSelectedAttachments();

  const assistantBubble = createAssistantBubble();

  activeRequest = new AbortController();
  setSendButtonReceiving(true);

  try {
    await llmChat({
      model: elements.model.value,
      abortSignal: activeRequest.signal,
      messages: messages,
      thinkingEnabled: elements.thinking.checked,
      updateUI: updateAssistantBubble.bind(null, assistantBubble)
    });
  } finally {
    activeRequest = null;
    setSendButtonReceiving(false);
    assistantBubble.bubble.scrollIntoView({ behavior: "auto", block: "end" });
  }
  console.log(messages);
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Ephyprompt starting");
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
        updateAssistantBubble(createAssistantBubble(), { content: message.content, thinking: message.reasoning_content, loading: false });
        break;
    }
  }
});