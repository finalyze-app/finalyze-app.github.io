#!/usr/bin/env python3
"""Tiny HTTPS static server so remote devices get a SECURE CONTEXT.

WebGPU (AI chat) and Cache Storage (AI model caching) are only exposed by
browsers over https:// or localhost. Serving the app over plain HTTP on a LAN
IP disables both. Run this to serve over HTTPS instead.

Usage:  python3 serve-https.py [port]
        (defaults to port 8443; cert/key paths can be overridden via env)
"""
import http.server, ssl, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
CERT = os.environ.get("FINALYZE_CERT", "/tmp/finalyze-cert.pem")
KEY = os.environ.get("FINALYZE_KEY", "/tmp/finalyze-key.pem")

os.chdir(os.path.dirname(os.path.abspath(__file__)))
httpd = http.server.HTTPServer(("0.0.0.0", PORT), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(CERT, KEY)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
print(f"Finalyze HTTPS server on https://0.0.0.0:{PORT}  (self-signed; accept the cert warning)")
httpd.serve_forever()
