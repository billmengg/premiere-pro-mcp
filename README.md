# Claude Bridge for Premiere Pro (home-made, free)

This bridge lets Claude build and export sequences in Premiere Pro on this PC, through any Claude chat linked to the computer.

```
Claude ⇄ mcp_server/server.py (stdio MCP) ⇄ http://127.0.0.1 (port 47615+) ⇄ Claude Bridge panel (CEP) ⇄ ExtendScript ⇄ Premiere
```

The panel only listens on localhost, and every request must carry a random token. The panel writes a new token to `%APPDATA%\ClaudePremiereBridge\token.txt` each time it starts. So nothing on the network, and no web page in a browser, can drive Premiere through it.

## Install (once)
1. Install Python 3 (python.org) if you don't have it.
2. Quit Premiere Pro and the Claude desktop app.
3. In this folder, run: `powershell -ExecutionPolicy Bypass -File .\install.ps1`
4. Start the Claude desktop app, then Premiere Pro.
5. Open the panel: Window > Extensions > Claude Bridge. It should say **Connected**.

## Tools Claude gets
| Tool | What it does |
| --- | --- |
| `premiere_status` | Checks the connection, and returns project info |
| `premiere_build_from_recipe` | One step: pipeline recipe → editable 1080x1920 sequence |
| `premiere_build_short` | Builds from an existing `timeline.json` (made by `export_premiere.py`) |
| `premiere_export` | Exports a sequence (in to out) with a Match Source H.264 preset, or one you pass |
| `premiere_import`, `premiere_project_info`, `premiere_find_presets` | Helpers |
| `premiere_run_extendscript` | Escape hatch: any Premiere scripting call |

## What a built sequence looks like
- **V1:** the shots, cut on the beats, scaled to fill 9:16 and panned to the recipe's crop. Beat cuts get a quick zoom-in that settles in 0.18s.
- **A1:** dialogue, from the story shots only.
- **V2:** a transparent caption overlay in the house style. Swap it for `captions.srt` if you want to edit the caption text.
- **A2:** the song, already timed: a quiet bed under the dialogue, then full volume from the drop.

The glow and colour grade are left to you in Premiere: put one adjustment layer over V1 and copy it to every sequence.

## Troubleshooting
- **Panel missing from Window > Extensions:** rerun the installer with Premiere fully closed, then restart Premiere.
- **"Port busy":** another copy of the panel is open. Close it, or restart Premiere.
- **Anything else:** send Claude the error from the tool result. The panel's log shows each command it ran.
