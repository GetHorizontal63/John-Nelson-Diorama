"""Local server for Diorama Maker that tells the browser never to cache, so code updates always load."""
import http.server
import os
import socketserver
import webbrowser

PORT = 5500


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


os.chdir(os.path.dirname(os.path.abspath(__file__)))
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), NoCacheHandler) as httpd:
    print(f'Diorama Maker at http://localhost:{PORT}  (Ctrl+C to stop)')
    webbrowser.open(f'http://localhost:{PORT}')
    httpd.serve_forever()
