import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { validateSubmission, type Validation } from "./validate.js";
import { buildZip } from "./zip.js";

export interface PackResult extends Validation {
  out?: string;
  zipBytes?: number;
}

/** Valida a pasta e grava o zip com o conteúdo na raiz (agent.yaml no topo). Não grava se houver erro. */
export function packSubmission(dir: string, out: string): PackResult {
  const v = validateSubmission(dir);
  if (v.errors.length > 0) return v;
  const root = resolve(dir);
  const entries = [...v.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => ({ name: f.path, data: readFileSync(join(root, f.path)) }));
  const zip = buildZip(entries);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, zip);
  return { ...v, out: resolve(out), zipBytes: zip.length };
}
