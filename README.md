# EphyPrompt

EphyPrompt is a simple LLM chat UI which runs completely locally and calls out to your LLM provider.

The name EphyPrompt is an abbreviation for Ephemeral Prompting.

It assumes the user brings their own LLM inference provider and has a quick and private chat with it.

With a vision model, it can handle pdf (via brute-force, rendering each page as an image).

## CUJs

1. As a user, I can enter my OpenAI-compatible baseURL, (e.g., baseURL: '<https://api.tensorx.ai/v1>'), and API key (apiKey: 'YOUR_API_KEY') and start chatting.
2. As a user, I can chat with the LLM API in the web UI via the streaming chat interface.
3. As a user, I can attach images, which are sent to the LLM API. The images and files are uploaded from my computer and sent directly to the LLM API as part of the prompt; they are never uploaded externally.
4. As a user, I can attach borked pdfs, which get sent to the LLM as images.
5. As a user, I can use EphyPrompt completely offline, as long as I can reach my LLM API.

## Architecture

* A single HTML file serves as the complete user interface.
* A tiny python webserver acts as proxy to send requests to the LLM provider. The API key is only exposed to this webserver.

## Properties

* If the external LLM provider has good privacy and does not retain any data, EphyPrompt is 100% private and retains 0 data.
* EphyPrompt is one single HTML file with JavaScript. And a tiny local proxy due tp CORS restrictions.
* EphyPrompt relies on aminimal set of external modules (only pymupdf) and does not include external data. This makes it extremely easy to audit.
* EphyPrompt can be easily run on common client operating systems.
* Data entered into EphyPrompt is only sent to your LLM API; it otherwise never leaves EphyPrompt.

## Known Issues

* Never share your API key.
* Since EphyPrompt shall run without external dependencies, we cannot `npm install openai` or `import OpenAI from "openai";`.
* Due to above, EphyPrompt is not using the official openai javascrip module, but only uses raw `fetch` (and `FormData` for file upload).
* Unfortunately, the tensorX API doesn't accept requests from the browser directly. Okay, this is actually a very good choice, since it prevents insecure setups which expose the API key to the client browser (which would be a feature in EphyPrompt, but is normally a very bad design). So we need a local proxy to resend the request to the API.
