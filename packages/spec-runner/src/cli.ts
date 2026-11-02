#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runSpecFile } from "./runner.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cwd: { type: "string" },
    "base-url": { type: "string" },
    playwright: { type: "string" },
  },
});

const specPath = positionals[0];
if (!specPath) {
  console.error("uso: spec-runner <events/<evento>/spec.yaml> [--cwd dir] [--base-url url] [--playwright cmd]");
  process.exit(2);
}

const report = await runSpecFile(specPath, {
  ...(values.cwd ? { cwd: values.cwd } : {}),
  ...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
  ...(values.playwright ? { playwrightCommand: values.playwright } : {}),
});
console.log(JSON.stringify(report, null, 2));
