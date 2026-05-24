#!/usr/bin/env python3
"""Dev server that disables caching so a plain browser refresh always loads the
current code. (Plain `python3 -m http.server` lets the browser cache index.html,
which can serve a stale mix of old/new JS and break things like import.)

Usage:  python3 serve.py [port]   # default port 8000
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving (no-cache) at http://localhost:{port}")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
