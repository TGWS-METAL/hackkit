#!/usr/bin/env bash
# Funções comuns dos hooks. O JSON do hook chega no stdin (https://code.claude.com/docs/en/hooks).

# json_field <caminho.com.pontos> : lê o campo do JSON guardado em $HOOK_INPUT.
json_field() {
  printf '%s' "$HOOK_INPUT" | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let v;
      try { v = JSON.parse(s); } catch { process.exit(0); }
      for (const k of process.argv[1].split(".")) v = v == null ? undefined : v[k];
      if (v !== undefined && v !== null) process.stdout.write(String(v));
    });
  ' "$1"
}

# Raiz do projeto: $CLAUDE_PROJECT_DIR, senão o cwd do JSON, senão o diretório atual.
project_root() {
  local root="${CLAUDE_PROJECT_DIR:-}"
  [ -z "$root" ] && root="$(json_field cwd)"
  [ -z "$root" ] && root="$PWD"
  printf '%s' "${root//\\//}"
}
