"use strict";

export async function llmChat({ model, abortSignal, messages, thinkingEnabled, updateUI }) {
  let assistantText = "";
  let assistantThinking = "";
  let lastChunk = null; // the most recent parsed SSE chunk; normally, the final one has API metadata, like usage information.

  try {
    let response = await fetch("/v1/chat/completions", {
      method: "POST",
      signal: abortSignal,
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
        chat_template_kwargs: { enable_thinking: thinkingEnabled, thinking: thinkingEnabled }
      })
    });
    console.log("[llmapi]", "Received response", { status: response.status, ok: response.ok, contentType: response.headers.get("content-type") });
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
        console.log("[llmapi]", "Stream finish reason", finishReason);
        if (finishReason !== "stop") {
          console.warn("[llmapi]", "Stream did not finish normally", { finishReason });
        }
      }
      updateUI({ content: assistantText, thinking: assistantThinking, loading: true });
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

    console.log("[llmapi]", "Final stream chunk", lastChunk);

    const reply = assistantText || "(no response)";
    updateUI({ content: reply, thinking: assistantThinking, loading: false });
    messages.push({
      role: "assistant",
      reasoning_content: assistantThinking,  // echo back the thinking, not all models seem to respect this.
      content: [{ type: "text", text: reply }]
    });
    console.log("[llmapi]", "Chat response completed");
  } catch (error) {
    updateUI({ content: `${assistantText} [ERROR] ERROR: ${error.message}`, thinking: assistantThinking, loading: false });
    console.warn("[llmapi]", "Chat response failed");
  }
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
      console.log("[llmapi]", "Stream finished");
      continue;
    }
    try {
      processData(JSON.parse(dataLine));
    } catch (error) {
      console.log("[llmapi]", "Failed to parse SSE payload", { dataLine, error: error.message });
      alert(error);
    }
  }
  return remainder;
}