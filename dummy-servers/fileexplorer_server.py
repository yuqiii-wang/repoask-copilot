"""File Explorer dummy server – serves files from one or more base directories.

Endpoints
---------
GET /                                       – HTML index of all roots
GET /api/files                              – JSON list of all roots
GET /api/files/{slug}                       – JSON list of files in that root
GET /api/files/{slug}/{path}                – Return file content (plain text)
GET /api/files/{slug}/{path}?lines=N        – Return first N lines
GET /api/files/{slug}/{path}/tail?lines=N   – Return last N lines (default 100)
GET /api/files/{slug}/{path}/search?q=kw    – Lines matching keyword (case-insensitive)
GET /api/search?q=keyword                   – Search across all roots
GET /api/search?q=keyword&root={slug}       – Search within one root

Usage:
    python fileexplorer_server.py [path1 path2 ...] [port]

    Each path is exposed as /api/files/{slug}/ where slug = directory name.
    Slugs are deduplicated automatically when names collide.
    If no paths are given, the current working directory is used.

Defaults: paths = [cwd], port = 8094
"""

import http.server
import json
import os
import sys
import urllib.parse
from pathlib import Path

_args = sys.argv[1:]
PORT = 8094
if _args and _args[-1].isdigit():
    PORT = int(_args[-1])
    _args = _args[:-1]

# Build { slug -> resolved Path } – deduplicate slugs derived from dir names
ROOTS: dict[str, Path] = {}
for _p in (_args or ["."]):
    _resolved = Path(_p).resolve()
    _slug = _resolved.name or "root"
    _base, _i = _slug, 2
    while _slug in ROOTS:
        _slug = f"{_base}_{_i}"
        _i += 1
    ROOTS[_slug] = _resolved


def _safe_path(slug: str, rel: str) -> Path | None:
    """Resolve a relative path safely under the named root. Returns None if unsafe."""
    root = ROOTS.get(slug)
    if root is None:
        return None
    try:
        target = (root / rel).resolve()
        target.relative_to(root)  # raises ValueError if outside root
        return target
    except (ValueError, Exception):
        return None


def _list_files(root: Path) -> list[dict]:
    items = []
    for p in sorted(root.rglob("*")):
        if p.is_file():
            items.append({
                "name": p.name,
                "path": p.relative_to(root).as_posix(),
                "size": p.stat().st_size,
            })
    return items


def _read_lines(path: Path) -> list[str]:
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        return fh.readlines()


class FileExplorerHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[fileexplorer] {self.address_string()} - {fmt % args}")

    def send_json(self, data: dict | list, status: int = 200):
        body = json.dumps(data, indent=2).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text: str, status: int = 200):
        body = text.encode("utf-8", errors="replace")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, html: str):
        body = html.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, status: int, msg: str):
        self.send_json({"error": msg}, status)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        params = dict(urllib.parse.parse_qsl(parsed.query))

        # GET /
        if path == "/":
            return self._handle_home()

        # GET /api/files  – list all roots
        if path == "/api/files":
            return self._handle_list()

        # GET /api/search?q=...[&root={slug}]
        if path == "/api/search":
            return self._handle_global_search(params)

        # GET /api/files/{slug}[/{rel_path}[/tail|/search]]
        if path.startswith("/api/files/"):
            rest = path[len("/api/files/"):]
            parts = rest.split("/", 1)
            slug = urllib.parse.unquote(parts[0])
            rel = urllib.parse.unquote(parts[1]) if len(parts) > 1 else ""

            if slug not in ROOTS:
                return self.error(404, f"Unknown root: {slug}")

            if not rel:
                return self._handle_list_root(slug)

            if rel.endswith("/tail"):
                return self._handle_tail(slug, rel[:-5], params)

            if rel.endswith("/search"):
                return self._handle_file_search(slug, rel[:-7], params)

            return self._handle_file(slug, rel, params)

        self.error(404, "Not found")

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def _handle_home(self):
        root_sections = []
        for slug, root in ROOTS.items():
            files = _list_files(root)
            rows = "".join(
                f'<tr><td><a href="/api/files/{slug}/{f["path"]}">{f["path"]}</a></td>'
                f'<td>{f["size"]}</td>'
                f'<td><a href="/api/files/{slug}/{f["path"]}/search?q=ERROR">search</a> | '
                f'<a href="/api/files/{slug}/{f["path"]}/tail?lines=50">tail</a></td></tr>'
                for f in files
            )
            root_sections.append(
                f'<h2>Root: <code>{slug}</code> → <code>{root}</code></h2>'
                f'<table border="1" cellpadding="4">'
                f'<tr><th>Path</th><th>Size (bytes)</th><th>Actions</th></tr>'
                f'{rows}</table>'
            )
        html = (
            "<!DOCTYPE html><html><head><title>File Explorer</title></head><body>"
            f"<h1>File Explorer</h1><p>Port: {PORT}</p>"
            + "".join(root_sections)
            + "</body></html>"
        )
        self.send_html(html)

    def _handle_list(self):
        roots_info = [
            {"slug": slug, "path": str(root), "url": f"/api/files/{slug}"}
            for slug, root in ROOTS.items()
        ]
        self.send_json({"roots": roots_info})

    def _handle_list_root(self, slug: str):
        root = ROOTS[slug]
        files = _list_files(root)
        self.send_json({"slug": slug, "base_dir": str(root), "files": files, "count": len(files)})

    def _handle_file(self, slug: str, rel: str, params: dict):
        target = _safe_path(slug, rel)
        if not target:
            return self.error(400, "Invalid path")
        if not target.is_file():
            return self.error(404, f"File not found: {rel}")
        lines = _read_lines(target)
        n = params.get("lines")
        if n:
            try:
                lines = lines[:int(n)]
            except ValueError:
                return self.error(400, "lines must be an integer")
        self.send_text("".join(lines))

    def _handle_tail(self, slug: str, rel: str, params: dict):
        target = _safe_path(slug, rel)
        if not target:
            return self.error(400, "Invalid path")
        if not target.is_file():
            return self.error(404, f"File not found: {rel}")
        n = int(params.get("lines", 100))
        lines = _read_lines(target)
        self.send_text("".join(lines[-n:]))

    def _handle_file_search(self, slug: str, rel: str, params: dict):
        q = params.get("q", "")
        if not q:
            return self.error(400, "q parameter required")
        target = _safe_path(slug, rel)
        if not target:
            return self.error(400, "Invalid path")
        if not target.is_file():
            return self.error(404, f"File not found: {rel}")
        lines = _read_lines(target)
        matches = [
            {"line": i + 1, "content": line.rstrip("\n")}
            for i, line in enumerate(lines)
            if q.lower() in line.lower()
        ]
        self.send_json({"root": slug, "file": rel, "query": q, "matches": matches, "count": len(matches)})

    def _handle_global_search(self, params: dict):
        q = params.get("q", "")
        if not q:
            return self.error(400, "q parameter required")
        # optional ?root=slug restricts search to one root
        target_root = params.get("root")
        search_roots = (
            {target_root: ROOTS[target_root]}
            if target_root and target_root in ROOTS
            else ROOTS
        )
        results = []
        for slug, root in search_roots.items():
            for f in _list_files(root):
                fpath = root / f["path"]
                try:
                    lines = _read_lines(fpath)
                except Exception:
                    continue
                file_matches = [
                    {"line": i + 1, "content": line.rstrip("\n")}
                    for i, line in enumerate(lines)
                    if q.lower() in line.lower()
                ]
                if file_matches:
                    results.append({"root": slug, "file": f["path"], "matches": file_matches})
        total = sum(len(r["matches"]) for r in results)
        self.send_json({"query": q, "results": results, "total_matches": total})


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), FileExplorerHandler)
    print(f"File Explorer server running on http://localhost:{PORT}")
    for slug, root in ROOTS.items():
        print(f"  Root '{slug}': {root}  ->  http://localhost:{PORT}/api/files/{slug}")
    server.serve_forever()
