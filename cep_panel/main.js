/* Claude Bridge panel: a localhost-only HTTP endpoint that runs ExtendScript in Premiere.
 * Every request must carry the token this panel writes to %APPDATA%\ClaudePremiereBridge\token.txt,
 * so web pages in a browser can't drive Premiere through this port. */
(function () {
  var http = require("http");
  var fs = require("fs");
  var path = require("path");
  var crypto = require("crypto");

  var PORT = 47615, MAX_PORT = 47635;   // uncommon range; falls forward if taken
  var dir = path.join(process.env.APPDATA || require("os").homedir(), "ClaudePremiereBridge");
  var token = crypto.randomBytes(24).toString("hex");
  var statusEl = document.getElementById("status");
  var logEl = document.getElementById("log");

  function log(msg) {
    var line = document.createElement("div");
    line.textContent = new Date().toLocaleTimeString() + "  " + msg;
    logEl.insertBefore(line, logEl.firstChild);
    while (logEl.childNodes.length > 60) logEl.removeChild(logEl.lastChild);
  }
  function setStatus(text, ok) { statusEl.textContent = text; statusEl.className = ok ? "ok" : "bad"; }


  // ExtendScript runs one call at a time: queue them.
  var queue = [], busy = false;
  function evalScript(script, cb) { queue.push([script, cb]); pump(); }
  function pump() {
    if (busy || !queue.length) return;
    busy = true;
    var job = queue.shift();
    window.__adobe_cep__.evalScript(job[0], function (res) { busy = false; job[1](res); pump(); });
  }

  var server = http.createServer(function (req, res) {
    function send(code, obj) {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    }
    if (req.headers["x-bridge-token"] !== token) return send(403, { ok: false, error: "bad token" });
    if (req.headers.origin) return send(403, { ok: false, error: "browser requests refused" });
    if (req.method === "GET" && req.url === "/ping") return send(200, { ok: true, panel: "claude-bridge" });
    if (req.method !== "POST" || req.url !== "/eval") return send(404, { ok: false, error: "not found" });
    var body = "";
    req.on("data", function (c) { body += c; if (body.length > 20e6) req.destroy(); });
    req.on("end", function () {
      var script;
      try { script = JSON.parse(body).script; } catch (e) { return send(400, { ok: false, error: "bad json" }); }
      log("run: " + script.slice(0, 70).replace(/\s+/g, " "));
      evalScript(script, function (result) {
        if (result === "EvalScript error.") { log("error"); return send(200, { ok: false, error: "ExtendScript error (see Premiere)" }); }
        send(200, { ok: true, result: result });
      });
    });
  });
  server.on("error", function (e) {
    if (e.code === "EADDRINUSE" && PORT < MAX_PORT) { PORT++; server.listen(PORT, "127.0.0.1"); return; }
    setStatus("Bridge error: " + e.message, false);
  });
  server.on("listening", function () {
    // only publish token + port once we really own the port
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "token.txt"), token);
      fs.writeFileSync(path.join(dir, "port.txt"), String(PORT));
    } catch (e) { setStatus("Can't write token: " + e.message, false); return; }
    setStatus("Connected: waiting for Claude on 127.0.0.1:" + PORT, true);
    log("listening; token in " + dir);
  });
  server.listen(PORT, "127.0.0.1");
})();
