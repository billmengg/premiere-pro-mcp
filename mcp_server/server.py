"""Claude <-> Premiere Pro MCP server (stdio). Talks to the Claude Bridge panel on 127.0.0.1.

Claude Desktop starts this (see install.ps1). The panel inside Premiere must be open:
Window > Extensions > Claude Bridge.
"""
from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:                                   # mcp SDK v2
    from mcp.server.mcpserver import MCPServer as _Server
except ImportError:                    # mcp SDK v1
    from mcp.server.fastmcp import FastMCP as _Server

mcp = _Server("premiere")
BRIDGE_DIR = Path(os.environ.get("APPDATA", Path.home())) / "ClaudePremiereBridge"
PIPELINE = Path(os.environ.get("SHORTS_PIPELINE", r"C:\Users\William\Documents\YouTube\Video\Arcane Footage\_shorts_pipeline"))


def _call(path: str, payload: dict | None = None, timeout: int = 300) -> dict:
    try:
        token = (BRIDGE_DIR / "token.txt").read_text().strip()
        port = int((BRIDGE_DIR / "port.txt").read_text().strip())
    except FileNotFoundError:
        return {"ok": False, "error": "Bridge panel has never run. In Premiere: Window > Extensions > Claude Bridge."}
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
                                 headers={"X-Bridge-Token": token, "Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Premiere panel not reachable ({e}). Is Premiere open with the Claude Bridge panel?"}


def _jsx(script: str, timeout: int = 300) -> dict:
    res = _call("/eval", {"script": script}, timeout)
    if not res.get("ok"):
        return res
    try:
        return json.loads(res["result"])
    except (TypeError, ValueError):
        return {"ok": True, "result": res.get("result")}


@mcp.tool()
def premiere_status() -> dict:
    """Check that Premiere Pro and the Claude Bridge panel are connected."""
    ping = _call("/ping")
    return ping if not ping.get("ok") else _jsx("cb_projectInfo()")


@mcp.tool()
def premiere_project_info() -> dict:
    """Open project name/path, Premiere version, sequence names and the active sequence."""
    return _jsx("cb_projectInfo()")


@mcp.tool()
def premiere_import(paths: list[str], bin_path: str = "Claude Imports") -> dict:
    """Import media files into a bin (nested bins with '/', e.g. 'Claude Shorts/Jenny')."""
    return _jsx(f"cb_importFiles({json.dumps(paths)}, {json.dumps(bin_path)})")


@mcp.tool()
def premiere_build_short(timeline_json: str) -> dict:
    """Assemble an editable 1080x1920 sequence from a timeline.json written by export_premiere.py:
    shots on V1 (dialogue on A1), caption overlay on V2, timed music on A2."""
    spec = json.loads(Path(timeline_json).read_text(encoding="utf-8"))
    return _jsx(f"cb_buildShort({json.dumps(spec)})", timeout=600)


@mcp.tool()
def premiere_build_from_recipe(recipe_path: str, index_dir: str = "index", out_dir: str = "premiere_builds") -> dict:
    """One step: run the shorts pipeline's export_premiere.py on a recipe, then build the sequence.
    Relative paths are resolved inside the pipeline folder."""
    rp = Path(recipe_path) if Path(recipe_path).is_absolute() else PIPELINE / recipe_path
    proc = subprocess.run([sys.executable, str(PIPELINE / "export_premiere.py"), str(rp),
                           "--index", index_dir, "--out", out_dir],
                          cwd=PIPELINE, capture_output=True, text=True)
    line = next((l for l in proc.stdout.splitlines() if l.startswith("OK ")), None)
    if not line:
        return {"ok": False, "error": (proc.stdout + proc.stderr)[-1500:]}
    return premiere_build_short(line[3:].strip())


@mcp.tool()
def premiere_find_presets(query: str = "Match Source") -> list[str]:
    """Find Adobe export presets (.epr) on this PC whose filename contains `query`."""
    roots = [r"C:\Program Files\Adobe", os.path.expandvars(r"%USERPROFILE%\Documents\Adobe")]
    hits = []
    for root in roots:
        hits += glob.glob(os.path.join(root, "**", f"*{query}*.epr"), recursive=True)
    return hits[:40]


@mcp.tool()
def premiere_export(sequence_name: str, out_path: str, preset_path: str | None = None) -> dict:
    """Export a sequence (in->out) straight from Premiere. Without preset_path, uses the first
    'Match Source - High bitrate' H.264 preset found."""
    if not preset_path:
        found = [p for p in premiere_find_presets("Match Source - High bitrate") if "h264" in p.lower() or "H.264" in p]
        found = found or premiere_find_presets("Match Source - High bitrate")
        if not found:
            return {"ok": False, "error": "No preset found; pass preset_path (see premiere_find_presets)."}
        preset_path = found[0]
    return _jsx(f"cb_exportSequence({json.dumps(sequence_name)}, {json.dumps(out_path)}, {json.dumps(preset_path)})",
                timeout=1800)


@mcp.tool()
def premiere_run_extendscript(code: str) -> dict:
    """Run arbitrary ExtendScript (ES3) in Premiere for anything the other tools don't cover.
    The last expression's value is returned as a string. Helpers available: cb_projectInfo(),
    cb_importFiles(paths, bin), cb_buildShort(spec), cb_exportSequence(name, out, preset)."""
    return _call("/eval", {"script": code})


# ----------------------------------------------------------------------------- publishing
PUBLISH = Path(os.environ.get("SHORTS_PUBLISH", str(PIPELINE / "publish")))


def _publisher(args: list[str], timeout: int = 60) -> dict:
    proc = subprocess.run([sys.executable, str(PUBLISH / "publisher.py"), *args], cwd=PUBLISH,
                          capture_output=True, text=True, timeout=timeout)
    line = next((l for l in reversed(proc.stdout.splitlines()) if l.startswith("RESULT ")), None)
    return json.loads(line[7:]) if line else {"ok": False, "error": (proc.stdout + proc.stderr)[-1500:]}


@mcp.tool()
def publish_accounts() -> dict:
    """List the posting accounts (niche, target platforms) and which platforms are connected."""
    return _publisher(["accounts"])


@mcp.tool()
def publish_video(account: str, file: str, caption: str, title: str = "", tags: list[str] | None = None,
                  platforms: list[str] | None = None, privacy: str = "public") -> dict:
    """Post one exported video for one account to YouTube Shorts / TikTok (inbox draft) / Instagram Reels.
    Runs in the background (uploads take minutes); poll publish_status(job_id) for the result.
    platforms defaults to every connected platform of the account."""
    import uuid
    job = uuid.uuid4().hex[:10]
    (PUBLISH / "jobs").mkdir(exist_ok=True)
    args = ["post", "--account", account, "--file", file, "--caption", caption, "--title", title,
            "--tags", ",".join(tags or []), "--privacy", privacy, "--job", job]
    if platforms:
        args += ["--platforms", ",".join(platforms)]
    flags = (subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP) if os.name == "nt" else 0
    log = open(PUBLISH / "jobs" / f"{job}.log", "w", encoding="utf-8")
    subprocess.Popen([sys.executable, str(PUBLISH / "publisher.py"), *args], cwd=PUBLISH,
                     stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
    return {"ok": True, "job_id": job, "note": "Started. Check publish_status(job_id) in a minute or two."}


@mcp.tool()
def publish_status(job_id: str) -> dict:
    """Result of a publish_video job: per-platform post id, URL, status and any action you need to take."""
    res = PUBLISH / "jobs" / f"{job_id}.json"
    if res.exists():
        return json.loads(res.read_text(encoding="utf-8"))
    log = PUBLISH / "jobs" / f"{job_id}.log"
    return {"done": False, "log_tail": log.read_text(encoding="utf-8")[-800:] if log.exists() else ""}


@mcp.tool()
def pull_stats(account: str | None = None) -> dict:
    """Pull current views/likes for every video on every connected account (or one account),
    append them to stats.csv, and return totals per account/platform plus the top 10 posts."""
    return _publisher(["stats"] + (["--account", account] if account else []), timeout=300)


if __name__ == "__main__":
    mcp.run()
