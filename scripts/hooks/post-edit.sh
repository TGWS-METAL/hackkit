#!/usr/bin/env bash
# PostToolUse em Edit|Write|MultiEdit (seção 7): typecheck e testes relacionados do pacote
# editado, com teto de 30 s. Exit 2 devolve o erro ao agente.
set -u
HOOK_INPUT="$(cat)"
. "$(dirname "$0")/lib.sh"

file="$(json_field tool_input.file_path)"
[ -z "$file" ] && exit 0
file="${file//\\//}"
root="$(project_root)"

# Caminho relativo à raiz (comparação sem diferenciar maiúsculas, por causa do Windows).
lower_file="$(printf '%s' "$file" | tr 'A-Z' 'a-z')"
lower_root="$(printf '%s' "$root" | tr 'A-Z' 'a-z')"
case "$lower_file" in
  "$lower_root"/*) rel="${file:${#root}+1}" ;;
  /*|[A-Za-z]:/*) exit 0 ;;
  *) rel="$file" ;;
esac

# Só arquivos dentro de packages/<x>, apps/<x> ou templates/<x> com package.json.
case "$rel" in
  packages/*/*|apps/*/*|templates/*/*) ;;
  *) exit 0 ;;
esac
pkg="$(printf '%s' "$rel" | cut -d/ -f1-2)"
[ -f "$root/$pkg/package.json" ] || exit 0

case "$rel" in
  *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

LIMIT="${HACKKIT_POST_EDIT_TIMEOUT:-30}"
out="$(
  cd "$root/$pkg" && timeout "$LIMIT" bash -c '
    pnpm run --if-present typecheck 2>&1 || exit 1
    if [ -x node_modules/.bin/vitest ] || [ -x ../../node_modules/.bin/vitest ]; then
      pnpm exec vitest related --run --passWithNoTests "$1" 2>&1 || exit 1
    fi
  ' _ "$root/$rel"
)"
code=$?
if [ $code -eq 124 ]; then
  echo "post-edit: typecheck/testes de $pkg passaram de ${LIMIT} s" >&2
  exit 2
elif [ $code -ne 0 ]; then
  printf 'post-edit: falha em %s\n%s\n' "$pkg" "$(printf '%s' "$out" | tail -n 60)" >&2
  exit 2
fi
exit 0
