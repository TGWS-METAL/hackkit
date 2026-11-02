#!/usr/bin/env node
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadSpec } from "@hackkit/spec-runner";
import { checkRules, hasRed } from "./check.js";
import { loadProfile } from "./profile.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: "string" },
    profile: { type: "string" },
    json: { type: "boolean" },
  },
});

const specPath = positionals[0];
if (!specPath) {
  console.error("uso: rules-check <events/<evento>/spec.yaml> [--profile profile.yaml] [--root dir] [--json]");
  process.exit(2);
}

const root = resolve(values.root ?? process.cwd());
const items = checkRules(loadSpec(specPath), loadProfile(values.profile ?? join(root, "profile.yaml")), { root });

if (values.json) console.log(JSON.stringify(items, null, 2));
else {
  console.log("item | status | motivo");
  for (const i of items) console.log(`${i.id} | ${i.status} | ${i.motivo}`);
}
process.exit(hasRed(items) ? 1 : 0);
