import fs from 'node:fs';
import path from 'node:path';

/**
 * Source registry + line coverage tracking for the simulated IBM i programs.
 * Executable-line rules approximate what the IBM i debugger exposes as
 * statement breakpoints (what CODECOV reports on).
 */
export function isExecutable(language, text, prevText = '') {
  const t = text.trim();
  if (!t) return false;
  if (language === 'RPGLE') {
    const l = t.toLowerCase();
    if (l.startsWith('//') || l.startsWith('**')) return false;
    if (/^(ctl-opt|dcl-f|dcl-s|dcl-c|dcl-ds|dcl-pi|dcl-pr|dcl-proc|end-ds|end-pi|end-pr|end-proc)\b/.test(l)) return false;
    if (/^(endif|endsl|other|else)\s*;/.test(l)) return false;
    return true;
  }
  if (language === 'CLLE') {
    const u = t.toUpperCase();
    if (u.startsWith('/*')) return false;
    if (prevText.trim().endsWith('+')) return false; // continuation
    if (/^(PGM|DCL|DCLF|ENDDO|ENDSELECT)\b/.test(u)) return false;
    return true;
  }
  return false;
}

export class SourceRegistry {
  constructor(rootDir, library = 'ORDLIB') {
    this.library = library;
    this.programs = new Map();
    const defs = [
      ['ORDINQ', 'QRPGLESRC/ORDINQ.rpgle', 'RPGLE'],
      ['CUSTINQ', 'QRPGLESRC/CUSTINQ.rpgle', 'RPGLE'],
      ['ORDMNU', 'QCLLESRC/ORDMNU.clle', 'CLLE'],
    ];
    for (const [program, rel, language] of defs) {
      const source = fs.readFileSync(path.join(rootDir, rel), 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');
      const executable = [];
      let inBlock = false;
      source.forEach((line, i) => {
        const l = line.trim().toLowerCase();
        if (language === 'RPGLE') {
          if (/^dcl-(ds|pi|pr)\b/.test(l) && !/end-(ds|pi|pr)|like(ds|rec)\(/.test(l)) { inBlock = true; return; }
          if (/^end-(ds|pi|pr)\b/.test(l)) { inBlock = false; return; }
          if (inBlock) return;
        }
        if (isExecutable(language, line, source[i - 1] || '')) executable.push(i + 1);
      });
      this.programs.set(program, { program, library, sourceFile: rel, language, source, executable, execSet: new Set(executable) });
    }
    this.cache = new Map();
  }

  /** Find 1-based line number containing `anchor`, searching after line containing `after`. */
  find(program, anchor, after = null, from = 0) {
    const key = `${program}|${anchor}|${after}|${from}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const p = this.programs.get(program);
    if (!p) throw new Error(`Unknown program ${program}`);
    let start = from;
    if (after) start = this.find(program, after, null, from);
    const idx = p.source.findIndex((l, i) => i >= start && l.includes(anchor));
    if (idx < 0) throw new Error(`Coverage anchor not found in ${program}: "${anchor}" (after "${after}")`);
    this.cache.set(key, idx + 1);
    return idx + 1;
  }
}

/** Collects hits for one collection (a device session or a CODECOV TESTID). */
export class CoverageTracker {
  constructor(registry, { programs = null, id = '' } = {}) {
    this.registry = registry;
    this.programs = programs ? new Set(programs.map((p) => p.toUpperCase())) : null;
    this.id = id;
    this.hits = new Map(); // program -> Map(line -> count)
    this.startedAt = new Date().toISOString();
  }

  wants(program) { return !this.programs || this.programs.has(program); }

  mark(program, line) {
    if (!this.wants(program)) return;
    const p = this.registry.programs.get(program);
    if (!p.execSet.has(line)) return;
    if (!this.hits.has(program)) this.hits.set(program, new Map());
    const m = this.hits.get(program);
    m.set(line, (m.get(line) || 0) + 1);
  }

  report() {
    const out = [];
    for (const p of this.registry.programs.values()) {
      if (!this.wants(p.program)) continue;
      const m = this.hits.get(p.program) || new Map();
      out.push({
        program: p.program, library: p.library, sourceFile: p.sourceFile, language: p.language,
        source: p.source, executable: p.executable, hits: Object.fromEntries(m),
      });
    }
    return { id: this.id, startedAt: this.startedAt, finishedAt: new Date().toISOString(), programs: out };
  }
}

/** Fan-out of hits to all trackers active for a session. */
export class CoverageProbe {
  constructor(registry) { this.registry = registry; this.trackers = new Set(); }
  add(t) { this.trackers.add(t); }
  remove(t) { this.trackers.delete(t); }

  /** Mark `n` executable lines starting at the line containing `anchor`. */
  hit(program, anchor, { after = null, n = 1 } = {}) {
    if (!this.trackers.size) return;
    const p = this.registry.programs.get(program);
    let line = this.registry.find(program, anchor, after);
    let marked = 0;
    while (marked < n && line <= p.source.length) {
      if (p.execSet.has(line)) { for (const t of this.trackers) t.mark(program, line); marked++; }
      line++;
    }
  }

  /** Mark every executable line between two anchors (inclusive). */
  range(program, fromAnchor, toAnchor, { after = null } = {}) {
    if (!this.trackers.size) return;
    const a = this.registry.find(program, fromAnchor, after);
    const b = this.registry.find(program, toAnchor, null, a - 1);
    const p = this.registry.programs.get(program);
    for (let l = a; l <= b; l++) if (p.execSet.has(l)) for (const t of this.trackers) t.mark(program, l);
  }
}
