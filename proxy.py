#!/usr/bin/env python3
"""A tiny proxy to make requests to the LLM API, since the API may not accept request from a browser due to CORS. Also rasterizes pdfs."""

from http.server import BaseHTTPRequestHandler, HTTPServer
from collections import Counter
import base64
import json
import os
import sys
import urllib.error
import urllib.request

import pymupdf

TENSORX_URL = "https://api.tensorx.ai"
API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
if not API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is not set.")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_FILES = {
    "/": ("ephyprompt.html", "text/html; charset=utf-8"),
    "/ephyprompt.html": ("ephyprompt.html", "text/html; charset=utf-8"),
    "/favicon.ico": ("favicon.ico", "image/x-icon"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
}


def rasterize_pdf(pdf_bytes, original_filename, dpi):
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        fname = os.path.splitext(os.path.basename(original_filename))[0] or "document"
        pages = []
        for index in range(doc.page_count):
            page = doc.load_page(index)
            if dpi == 'auto':
                zoom = 640 / page.rect.width
                pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            else:
                pix = page.get_pixmap(dpi=dpi)
            png_bytes = pix.tobytes("png")
            name = f"{fname}-page-{str(index + 1).zfill(len(str(doc.page_count)))}.png"
            data_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
            pages.append({"name": name, "url": data_url})
        return {"pages": pages}

def summarize_payload(payload, raw_body):
    messages = payload.get("messages") or []
    return {
        **{k: v for k, v in payload.items() if k != "messages"},
        "messages": {
            "count": len(messages),
            "roles": Counter(m.get("role", "?") for m in messages if isinstance(m, dict)),
            "types": Counter(
                p.get("type", "?")
                for m in messages if isinstance(m, dict)
                for p in (m.get("content") if isinstance(m.get("content"), list) else [])
                if isinstance(p, dict)
            ),
        },
        "bytes": len(raw_body),
    }


class Handler(BaseHTTPRequestHandler):

    def send_csp(self):
        """Main Content Security Policy for the main page."""
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'none'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none';")

    def send_api_headers(self):
        """Strict headers with strict Content Security Policy for raw bytes API requests."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'none';")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, status: int, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_api_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_api_headers()
        self.end_headers()

    def serve_static(self, filename, content_type):
        file_path = os.path.join(BASE_DIR, filename)
        if not os.path.isfile(file_path):
            self.send_error(404, f"{filename} not found")
            return
        try:
            with open(file_path, "rb") as fh:
                body = fh.read()
        except OSError as e:
            print(f"Unable to read {filename}: {e}")
            self.send_error(500, f"Unable to read {filename}")
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_csp()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/v1/model/info":
            self.fwd_request(urllib.request.Request(
                    TENSORX_URL + path,
                    headers={
                        "Authorization": f"Bearer {API_KEY}",
                        "Content-Type": "application/json"
                    },
                    method="GET"
                ))
            return

        entry = STATIC_FILES.get(path)
        if entry is None:
            self.send_error(404, "Not Found")
            return
        filename, content_type = entry
        self.serve_static(filename, content_type )

    def do_POST(self):
        if self.headers.get("Sec-Fetch-Site") != "same-origin":  # CORS: same-origin requests only.
            self.send_error(403, "Refusing non-local request")
            raise RuntimeError("Received non-local request. This is unexpected usage.")
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
                    dpi = max(36, min(600, int(dpi_raw)))
                except ValueError:
                    dpi = 'auto'
                print(f"[proxy] POST {path} filename={original_filename} dpi={dpi} bytes={len(pdf_bytes)}")

                result = rasterize_pdf(pdf_bytes, original_filename, dpi)
                body = json.dumps(result).encode("utf-8")

                self.send_json(200, body)
            except Exception as e:
                print(f"[proxy] rasterize-pdf failed: {e}", file=sys.stderr)
                error_body = json.dumps({"error": str(e)}).encode("utf-8")
                self.send_json(500, error_body)
            return

        if path != "/v1/chat/completions":
            self.send_error(404, "Not Found")
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            payload = json.loads(body or b"{}")
        except (BrokenPipeError, ConnectionResetError):
            print("Client disconnected while sending request body")
            return
        except ValueError as e:
            print(f"[proxy] bad request: {e}", file=sys.stderr)
            self.send_json(400, json.dumps({"error": str(e)}).encode("utf-8"))
            return

        print(f"[proxy] POST {path} model={payload.get('model')} stream={payload.get('stream')} messages={len(payload.get('messages', []))}")
        print(f"[proxy] request summary: {summarize_payload(payload, body)}")
        self.fwd_request(urllib.request.Request(
                TENSORX_URL + path,
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {API_KEY}",
                    "Content-Type": "application/json"
                },
                method="POST"
            ))

    def fwd_request(self, req: urllib.request.Request):
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.getcode()
                content_type = resp.headers.get("Content-Type", "application/json")
                print(f"[proxy] upstream status={status} content-type={content_type}")

                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_api_headers()
                self.end_headers()

                while True:
                    print(".", end="", flush=True)
                    chunk = resp.read(128) # roughly the size of a SSE data: line.
                    if not chunk:
                        print()
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", "replace")
            print(f"[proxy] upstream error status={e.code} body={error_body[:500]}", file=sys.stderr)
            self.send_json(e.code, error_body.encode("utf-8"))
        except (BrokenPipeError, ConnectionResetError) as e:
            print(f"Client disconnected: {type(e).__name__}")
        except Exception as e:
            print(f"[proxy] request failed: {e}", file=sys.stderr)
            error_body = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_json(500, error_body)


if __name__ == "__main__":
    print("EphyPrompt running at http://localhost:3000/")
    HTTPServer(("localhost", 3000), Handler).serve_forever()
