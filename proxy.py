#!/usr/bin/env python3
"""A tiny proxy to make requests to the LLM API, since the API may not accept request from a browser due to CORS."""

from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
import base64
import json
import os
import sys
import urllib.error
import urllib.request

import pymupdf

TENSORX_URL = "https://api.tensorx.ai/v1/chat/completions"
API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is not set.")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_PATH = os.path.join(BASE_DIR, "ephyprompt.html")


def rasterize_pdf(pdf_bytes, original_filename, dpi=72):
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        width = max(2, len(str(page_count)))
        stem = os.path.splitext(os.path.basename(original_filename or "document"))[0] or "document"
        pages = []
        for index in range(page_count):
            page = doc.load_page(index)
            pix = page.get_pixmap(dpi=dpi)
            jpg_bytes = pix.tobytes("jpg")
            name = f"{stem}-page-{str(index + 1).zfill(width)}.jpg"
            pages.append({"name": name, "data": base64.b64encode(jpg_bytes).decode("ascii")})
        return {"pages": pages}
    finally:
        doc.close()

def summarize_payload(payload, raw_body):
    """Return a one-line summary of the request payload for logging."""
    messages = payload.get("messages") or []
    role_counts = {}
    image_count = 0
    text_chars = 0
    tool_call_count = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "?")
        role_counts[role] = role_counts.get(role, 0) + 1
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = part.get("type")
                if ptype == "image_url":
                    image_count += 1
                elif ptype == "text":
                    text_chars += len(part.get("text", "") or "")
        elif isinstance(content, str):
            text_chars += len(content)
        tool_calls = msg.get("tool_calls")
        if isinstance(tool_calls, list):
            tool_call_count += len(tool_calls)

    parts = [
        f"messages={len(messages)}",
        f"roles={role_counts}",
        f"images={image_count}",
        f"text_chars={text_chars}",
        f"tool_calls={tool_call_count}",
    ]

    extras = []
    for key in ("temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"):
        if key in payload:
            extras.append(f"{key}={payload[key]}")
    if "response_format" in payload:
        extras.append(f"response_format={payload['response_format']}")
    tools = payload.get("tools")
    if isinstance(tools, list) and tools:
        tool_names = [t.get("function", {}).get("name", "?") for t in tools if isinstance(t, dict)]
        extras.append(f"tools={tool_names}")
    if payload.get("stream"):
        extras.append("stream=true")

    if extras:
        parts.append("opts={" + ", ".join(extras) + "}")

    parts.append(f"bytes={len(raw_body)}")

    return " ".join(parts)


class Handler(BaseHTTPRequestHandler):

    def send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors()
        self.end_headers()

    def serve_static_html(self):
        if not os.path.exists(HTML_PATH):
            self.send_error(404, "ephyprompt.html not found")
            return

        with open(HTML_PATH, "r", encoding="utf-8") as fh:
            body = fh.read().encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/ephyprompt.html"):
            self.serve_static_html()
            return
        self.send_error(404, "Not Found")

    def do_POST(self):
        client_ip = self.address_string()
        path = self.path

        if path == "/rasterize-pdf":
            try:
                length = int(self.headers.get("Content-Length", 0))
                pdf_bytes = self.rfile.read(length) if length > 0 else b""
                if not pdf_bytes:
                    raise ValueError("Empty PDF payload")

                original_filename = self.headers.get("X-Filename", "")
                dpi_raw = self.headers.get("X-DPI", "").strip()
                try:
                    dpi = int(dpi_raw) if dpi_raw else 72
                except ValueError:
                    dpi = 72
                # Clamp to a sane range to avoid accidentally huge images.
                dpi = max(36, min(600, dpi))
                print(f"[proxy] POST {path} from {client_ip} filename={original_filename} dpi={dpi} bytes={len(pdf_bytes)}")

                result = rasterize_pdf(pdf_bytes, original_filename, dpi)
                body = json.dumps(result).encode("utf-8")

                self.send_response(200)
                self.send_cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as e:
                print(f"[proxy] rasterize-pdf failed: {e}", file=sys.stderr)
                error_body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_response(500)
                self.send_cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(error_body)))
                self.end_headers()
                self.wfile.write(error_body)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body or b"{}")

            print(f"[proxy] POST {path} from {client_ip} model={payload.get('model')} stream={payload.get('stream')} messages={len(payload.get('messages', []))}")
            print(f"[proxy] request summary: {summarize_payload(payload, body)}")

            req = urllib.request.Request(
                TENSORX_URL,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json"
                },
                method="POST"
            )

            with urllib.request.urlopen(req) as resp:
                status = resp.getcode()
                content_type = resp.headers.get("Content-Type", "application/json")
                print(f"[proxy] upstream status={status} content-type={content_type}")

                self.send_response(status)
                self.send_cors()
                self.send_header("Content-Type", content_type)
                self.end_headers()

                while True:
                    print(".", end="", flush=True)
                    chunk = resp.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", "replace")
            print(f"[proxy] upstream error status={e.code} body={error_body[:500]}", file=sys.stderr)

            self.send_response(e.code)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(error_body.encode("utf-8"))

        except Exception as e:
            print(f"[proxy] request failed: {e}", file=sys.stderr)
            self.send_response(500)
            self.send_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(str(e).encode("utf-8"))


if __name__ == "__main__":
    print("EphyPrompt proxy running at http://localhost:3000")
    print("Open the UI at http://localhost:3000/ephyprompt.html")
    HTTPServer(("localhost", 3000), Handler).serve_forever()