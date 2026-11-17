/**
 * Finding a project's `.beads` and a cheap change marker for it — port of
 * resolveProject / revisionOf from the reference.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/**
 * What makes a `.beads` directory an actual project rather than an empty shell
 * some unrelated tool left behind (there is one in /root holding only
 * `eventsData`).
 */
const BEADS_MARKERS = ["config.yaml", "issues.jsonl", "embeddeddolt", "metadata.json"];

function looksLikeBeadsProject(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((name) => BEADS_MARKERS.includes(name) || name.endsWith(".db"));
  } catch {
    return false;
  }
}

export type ProjectVerdict =
  | { ok: true; root: string; beadsDir: string }
  | { ok: false; code: string; project: string | null };

/**
 * Validate a directory and find its `.beads`, walking up exactly like `bd`.
 * In Paseo the directory comes from the daemon's own workspace record, never
 * from the client; the checks stay because that record can point at a
 * directory that has since gone.
 */
export function resolveProject(raw: unknown): ProjectVerdict {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, code: "no_path", project: null };
  if (!path.isAbsolute(raw)) return { ok: false, code: "not_absolute", project: raw };

  let real: string;
  try {
    real = fs.realpathSync(raw);
    if (!fs.statSync(real).isDirectory()) return { ok: false, code: "not_a_directory", project: raw };
  } catch {
    return { ok: false, code: "not_found", project: raw };
  }

  let dir = real;
  for (;;) {
    const candidate = path.join(dir, ".beads");
    try {
      if (fs.statSync(candidate).isDirectory() && looksLikeBeadsProject(candidate)) {
        return { ok: true, root: dir, beadsDir: candidate };
      }
    } catch {
      // keep walking up
    }
    const up = path.dirname(dir);
    if (up === dir) return { ok: false, code: "no_beads", project: real };
    dir = up;
  }
}

/**
 * A marker that changes when the data changes and *not* when it is merely
 * read. Dolt bumps its manifest's mtime on every read, so the noms store
 * counts by size only; issues.jsonl by size + mtime.
 */
export function revisionOf(beadsDir: string): string {
  const parts: string[] = [];
  try {
    const st = fs.statSync(path.join(beadsDir, "issues.jsonl"));
    parts.push(`jsonl:${st.size}:${Math.round(st.mtimeMs)}`);
  } catch {
    parts.push("jsonl:-");
  }
  const dolt = path.join(beadsDir, "embeddeddolt");
  try {
    for (const db of fs.readdirSync(dolt).sort()) {
      const noms = path.join(dolt, db, ".dolt", "noms");
      let entries: string[];
      try {
        entries = fs.readdirSync(noms).sort();
      } catch {
        continue;
      }
      for (const name of entries) {
        if (name === "LOCK") continue; // touched by readers
        try {
          parts.push(`${db}/${name}:${fs.statSync(path.join(noms, name)).size}`);
        } catch {
          // vanished mid-scan: the next poll sees the settled state
        }
      }
    }
  } catch {
    // no embedded database — jsonl mode
  }
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}
