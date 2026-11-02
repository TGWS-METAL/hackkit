#!/usr/bin/env node
import { parseArgs } from "node:util";
import { packSubmission } from "./pack.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string", short: "o" } },
});

const dir = positionals[0] ?? "submission";
const out = values.out ?? "submission.zip";
const r = packSubmission(dir, out);

console.log(`arquivos: ${r.files.length}`);
console.log(`bytes descompactados: ${r.totalBytes}`);
console.log(`modelo: ${r.models.join(", ") || "-"}`);
if (r.errors.length > 0) {
  for (const e of r.errors) console.error(`erro: ${e}`);
  console.error(`${r.errors.length} erros; ${out} não foi gravado`);
  process.exit(1);
}
console.log(`zip: ${r.out} (${r.zipBytes} bytes)`);
