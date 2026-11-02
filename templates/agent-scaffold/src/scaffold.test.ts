import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { packSubmission } from "./pack.js";
import { validateSubmission } from "./validate.js";
import { buildZip } from "./zip.js";

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "submission");

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "sub-"));
  cpSync(TEMPLATE, dir, { recursive: true });
  return dir;
}

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** Lê o zip pelo diretório central e devolve nome -> conteúdo. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const body = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    p += 46 + nameLen;
  }
  return out;
}

describe("template", () => {
  it("submission/ do template passa na validação", () => {
    const v = validateSubmission(TEMPLATE);
    expect(v.errors).toEqual([]);
    expect(v.models).toEqual(["gemma-4-31b-it-qat-w4a16-ct"]);
  });
});

describe("validateSubmission", () => {
  it("sem config raiz e com dois configs raiz", () => {
    const empty = mkdtempSync(join(tmpdir(), "sub-"));
    expect(validateSubmission(empty).errors[0]).toContain("nenhum config raiz");
    const two = copy();
    write(two, "root_agent.yaml", "name: x\nmodel: gemma-4-31b-it-qat-w4a16-ct\n");
    expect(validateSubmission(two).errors[0]).toContain("mais de um config raiz");
  });

  it("extensão proibida, adapter inexistente e ferramenta inexistente", () => {
    const dir = copy();
    write(dir, "weights.bin", "x");
    write(
      dir,
      "agent.yaml",
      "name: a\nmodel: gemma-4-31b-it-qat-w4a16-ct\nadapter: main_lora\ntools: [run_command, browse_web]\n",
    );
    const errors = validateSubmission(dir).errors.join("\n");
    expect(errors).toContain("weights.bin: extensão .bin não aceita");
    expect(errors).toContain("adapter main_lora não existe");
    expect(errors).toContain("ferramenta browse_web não existe");
  });

  it("sub-agente com outro modelo e modelo fora da lista", () => {
    const dir = copy();
    write(
      dir,
      "agent.yaml",
      [
        "name: root",
        "model: gemma-4-31b-it-qat-w4a16-ct",
        "tools:",
        "  - agent_tool:",
        "      config_path: sub_agents/a.yaml",
        "sub_agents:",
        "  - config_path: sub_agents/b.yaml",
      ].join("\n"),
    );
    write(dir, "sub_agents/a.yaml", "name: a\nmodel: openai/gemma-4-e2b-it-qat-w4a16-ct\ninstruction: !include ../prompts/system.md\n");
    write(dir, "sub_agents/b.yaml", "name: b\nmodel: gemma-4-31b-it\n");
    const errors = validateSubmission(dir).errors.join("\n");
    expect(errors).toContain("mais de um modelo base");
    expect(errors).toContain("modelo gemma-4-31b-it fora de ALLOWED_MODEL_NAMES");
    expect(errors).not.toContain("sai da raiz");
  });

  it("!include que sai da raiz e max_output_tokens acima de 32768", () => {
    const dir = copy();
    write(dir, "agent.yaml", "name: a\nmodel: gemma-4-31b-it-qat-w4a16-ct\ninstruction: !include ../fora.md\n");
    expect(validateSubmission(dir).errors.join("\n")).toContain("sai da raiz");
    write(
      dir,
      "agent.yaml",
      "name: a\nmodel: gemma-4-31b-it-qat-w4a16-ct\ngenerate_content_config: { max_output_tokens: 40000 }\n",
    );
    expect(validateSubmission(dir).errors.join("\n")).toContain("max_output_tokens 40000 fora de 1..32768");
  });

  it("link simbólico é erro", (ctx) => {
    const dir = copy();
    try {
      symlinkSync(join(dir, "prompts", "system.md"), join(dir, "prompts", "link.md"));
    } catch {
      ctx.skip(); // Windows sem permissão de criar symlink
    }
    expect(validateSubmission(dir).errors.join("\n")).toContain("prompts/link.md: link simbólico");
  });
});

describe("zip", () => {
  it("buildZip: conteúdo volta igual (deflate e stored)", () => {
    const big = Buffer.from("abc".repeat(1000));
    const tiny = Buffer.from("x");
    const files = unzip(buildZip([{ name: "a/big.txt", data: big }, { name: "tiny.txt", data: tiny }]));
    expect(files.get("a/big.txt")).toEqual(big);
    expect(files.get("tiny.txt")).toEqual(tiny);
  });

  it("packSubmission grava o zip com agent.yaml na raiz e não grava se houver erro", () => {
    const out = join(mkdtempSync(join(tmpdir(), "zip-")), "submission.zip");
    const r = packSubmission(TEMPLATE, out);
    expect(r.errors).toEqual([]);
    const files = unzip(readFileSync(out));
    expect([...files.keys()]).toEqual(["agent.yaml", "configs/sampling.yaml", "prompts/system.md"]);
    expect(files.get("agent.yaml")!.toString()).toBe(readFileSync(join(TEMPLATE, "agent.yaml"), "utf8"));

    const bad = mkdtempSync(join(tmpdir(), "sub-"));
    const badOut = join(bad, "out.zip");
    expect(packSubmission(bad, badOut).out).toBeUndefined();
    expect(() => readFileSync(badOut)).toThrow();
  });

  it("o zip abre no zipfile do Python", (ctx) => {
    const py = spawnSync("python", ["-c", "print(1)"]);
    if (py.status !== 0) ctx.skip();
    const out = join(mkdtempSync(join(tmpdir(), "zip-")), "submission.zip");
    packSubmission(TEMPLATE, out);
    const r = spawnSync(
      "python",
      ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(','.join(z.namelist()))", out],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("agent.yaml,configs/sampling.yaml,prompts/system.md");
  });
});
