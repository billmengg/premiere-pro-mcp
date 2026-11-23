// Claude Bridge — ExtendScript side (ES3: no let/const/arrow/JSON object).
// Every cb_* function returns a JSON string.

function __q(s) {
  return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
}
function __toJSON(v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(v) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return __q(v);
  if (v instanceof Array) {
    var a = [];
    for (var i = 0; i < v.length; i++) a.push(__toJSON(v[i]));
    return "[" + a.join(",") + "]";
  }
  var parts = [];
  for (var k in v) if (v.hasOwnProperty(k)) parts.push(__q(k) + ":" + __toJSON(v[k]));
  return "{" + parts.join(",") + "}";
}
function __ok(obj) { obj = obj || {}; obj.ok = true; return __toJSON(obj); }
function __err(msg) { return __toJSON({ ok: false, error: String(msg) }); }

function __norm(p) { return String(p).replace(/\//g, "\\").toLowerCase(); }

function __findByPath(item, path) {
  var target = __norm(path);
  for (var i = 0; i < item.children.numItems; i++) {
    var c = item.children[i];
    if (c.type === 2) { var r = __findByPath(c, path); if (r) return r; }       // bin
    else {
      try { if (__norm(c.getMediaPath()) === target) return c; } catch (e) {}
    }
  }
  return null;
}
function __findChildBin(parent, name) {
  for (var i = 0; i < parent.children.numItems; i++) {
    var c = parent.children[i];
    if (c.type === 2 && c.name === name) return c;
  }
  return null;
}
function __bin(pathParts) {
  var cur = app.project.rootItem;
  for (var i = 0; i < pathParts.length; i++) {
    var b = __findChildBin(cur, pathParts[i]);
    if (!b) { cur.createBin(pathParts[i]); b = __findChildBin(cur, pathParts[i]); }
    cur = b;
  }
  return cur;
}
function __import(paths, bin) {
  var need = [];
  for (var i = 0; i < paths.length; i++) if (!__findByPath(app.project.rootItem, paths[i])) need.push(paths[i]);
  if (need.length) app.project.importFiles(need, true, bin, false);
  var items = {};
  for (var j = 0; j < paths.length; j++) {
    var it = __findByPath(app.project.rootItem, paths[j]);
    if (!it) throw new Error("Import failed: " + paths[j]);
    items[__norm(paths[j])] = it;
  }
  return items;
}
function __ticks(sec) { var t = new Time(); t.seconds = sec; return t.ticks; }
function __setIn(item, sec) { try { item.setInPoint(sec, 4); } catch (e) { item.setInPoint(__ticks(sec), 4); } }
function __setOut(item, sec) { try { item.setOutPoint(sec, 4); } catch (e) { item.setOutPoint(__ticks(sec), 4); } }
function __pad(n) { return (n < 10 ? "0" : "") + n; }
function __tc(sec, fps) {
  var f = Math.round(sec * fps);
  var ff = f % fps, ts = Math.floor(f / fps);
  return __pad(Math.floor(ts / 3600)) + ":" + __pad(Math.floor(ts / 60) % 60) + ":" + __pad(ts % 60) + ":" + __pad(ff);
}
function __clipAt(track, sec) {
  for (var i = track.clips.numItems - 1; i >= 0; i--) {
    var c = track.clips[i];
    if (Math.abs(c.start.seconds - sec) < 0.05) return c;
  }
  return null;
}
function __prop(trackItem, compName, propName) {
  for (var i = 0; i < trackItem.components.numItems; i++) {
    var comp = trackItem.components[i];
    if (comp.displayName === compName) {
      for (var j = 0; j < comp.properties.numItems; j++)
        if (comp.properties[j].displayName === propName) return comp.properties[j];
    }
  }
  return null;
}
function __clearSequence(seq) {
  var i, j;
  for (i = 0; i < seq.videoTracks.numTracks; i++)
    for (j = seq.videoTracks[i].clips.numItems - 1; j >= 0; j--) seq.videoTracks[i].clips[j].remove(false, false);
  for (i = 0; i < seq.audioTracks.numTracks; i++)
    for (j = seq.audioTracks[i].clips.numItems - 1; j >= 0; j--) seq.audioTracks[i].clips[j].remove(false, false);
}

// ---------------------------------------------------------------- tools
function cb_projectInfo() {
  try {
    var p = app.project;
    var seqs = [];
    for (var i = 0; i < p.sequences.numSequences; i++) seqs.push(p.sequences[i].name);
    return __ok({ project: p.name, path: p.path, sequences: seqs,
                  active: p.activeSequence ? p.activeSequence.name : null, version: app.version });
  } catch (e) { return __err(e); }
}

function cb_importFiles(paths, binPath) {
  try {
    var bin = __bin(binPath ? String(binPath).split("/") : ["Claude Imports"]);
    __import(paths, bin);
    return __ok({ imported: paths.length });
  } catch (e) { return __err(e); }
}

function cb_buildShort(spec) {
  try {
    var bin = __bin(["Claude Shorts", spec.name]);
    var paths = [], seen = {};
    for (var i = 0; i < spec.shots.length; i++) {
      var k = __norm(spec.shots[i].src);
      if (!seen[k]) { seen[k] = true; paths.push(spec.shots[i].src); }
    }
    paths.push(spec.music);
    if (spec.captions) paths.push(spec.captions);
    var items = __import(paths, bin);

    // sequence: create from the first clip, switch to vertical, empty it
    var first = items[__norm(spec.shots[0].src)];
    var seq = app.project.createNewSequenceFromClips(spec.name, [first], bin);
    var st = seq.getSettings();
    st.videoFrameWidth = spec.width;
    st.videoFrameHeight = spec.height;
    seq.setSettings(st);
    __clearSequence(seq);
    if (seq.videoTracks.numTracks < 2 || seq.audioTracks.numTracks < 2)
      return __err("Sequence needs at least 2 video and 2 audio tracks");

    var V1 = seq.videoTracks[0], A1 = seq.audioTracks[0], warnings = [];
    for (var s = 0; s < spec.shots.length; s++) {
      var sh = spec.shots[s];
      var it = items[__norm(sh.src)];
      __setIn(it, sh.src_in);
      __setOut(it, sh.src_in + sh.dur);
      V1.overwriteClip(it, sh.t);
      try { it.clearInPoint(); it.clearOutPoint(); } catch (e0) {}

      var ti = __clipAt(V1, sh.t);
      if (!ti) { warnings.push("shot " + s + " not found after placing"); continue; }
      // fill the 9:16 frame and pan to cx
      var scale = Math.max(spec.width / sh.src_w, spec.height / sh.src_h) * 100;
      var scaleP = __prop(ti, "Motion", "Scale");
      var posP = __prop(ti, "Motion", "Position");
      try { scaleP.setValue(scale, true); } catch (e1) { warnings.push("scale " + s + ": " + e1); }
      try {
        var scaledW = sh.src_w * scale / 100;
        var x = 0.5 + (0.5 - sh.cx) * (scaledW - spec.width) / spec.width;
        posP.setValue([x, 0.5], true);
      } catch (e2) { warnings.push("position " + s + ": " + e2); }
      if (sh.punch) {   // zoom kick that settles in 0.18 s
        try {
          var t0 = ti.inPoint.seconds;
          scaleP.setTimeVarying(true);
          scaleP.addKey(t0); scaleP.setValueAtKey(t0, scale * 1.07, true);
          scaleP.addKey(t0 + 0.18); scaleP.setValueAtKey(t0 + 0.18, scale, true);
        } catch (e3) { warnings.push("punch " + s + ": " + e3); }
      }
      if (!sh.keep_audio) { var au = __clipAt(A1, sh.t); if (au) au.remove(false, false); }
    }
    // music + captions trimmed to the Short's length
    var mus = items[__norm(spec.music)];
    __setIn(mus, 0); __setOut(mus, spec.total);
    seq.audioTracks[1].overwriteClip(mus, 0);
    try { mus.clearInPoint(); mus.clearOutPoint(); } catch (e6) {}
    if (spec.captions) {
      var cap = items[__norm(spec.captions)];
      __setIn(cap, 0); __setOut(cap, spec.total);
      seq.videoTracks[1].overwriteClip(cap, 0);
      try { cap.clearInPoint(); cap.clearOutPoint(); } catch (e7) {}
    }
    try { seq.setInPoint(0); seq.setOutPoint(spec.total); } catch (e4) {}
    app.project.openSequence(seq.sequenceID);
    if (spec.split_music) {   // razor the song (A2) at every clip change so each section is its own piece
      try {
        app.enableQE();
        var qseq = qe.project.getActiveSequence();
        var fd = seq.getSettings().videoFrameRate.seconds;
        var fps = Math.round(1 / fd);
        var qA2 = qseq.getAudioTrackAt(1);
        for (var b = 1; b < spec.shots.length; b++) qA2.razor(__tc(spec.shots[b].t, fps));
      } catch (e5) { warnings.push("music split: " + e5); }
    }
    return __ok({ sequence: seq.name, shots: spec.shots.length, warnings: warnings });
  } catch (e) { return __err(e + (e.line ? " (line " + e.line + ")" : "")); }
}

function cb_exportSequence(name, outPath, presetPath) {
  try {
    var seq = null;
    for (var i = 0; i < app.project.sequences.numSequences; i++)
      if (app.project.sequences[i].name === name) seq = app.project.sequences[i];
    if (!seq) return __err("No sequence named " + name);
    var ok = seq.exportAsMediaDirect(outPath, presetPath, 1);   // 1 = in to out
    return __ok({ exported: outPath, result: String(ok) });
  } catch (e) { return __err(e); }
}
