#!/usr/bin/env bash
# Stop (seção 7): roda a suíte dos pacotes alterados e grava runs/<evento>/<tarefa>.status.json.
# Só age em tarefas despachadas pelo orquestrador (HACKKIT_EVENT e HACKKIT_TASK definidos).
# Suíte vermelha: exit 2 impede o agente de parar; se o agente já continua por causa deste
# hook (stop_hook_active), grava o status vermelho e deixa parar.
set -u
HOOK_INPUT="$(cat)"
. "$(dirname "$0")/lib.sh"

[ -z "${HACKKIT_EVENT:-}" ] || [ -z "${HACKKIT_TASK:-}" ] && exit 0
root="$(project_root)"
runs="${HACKKIT_RUNS_DIR:-$root/runs}"
runs="${runs//\\//}"
active="$(json_field stop_hook_active)"

# Pacotes com arquivos alterados: diff contra HEAD, não rastreados e, se definido,
# os commits desde HACKKIT_BASE_REF.
changed="$(
  cd "$root" && {
    git diff --name-only HEAD 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
    [ -n "${HACKKIT_BASE_REF:-}" ] && git diff --name-only "$HACKKIT_BASE_REF...HEAD" 2>/dev/null
  } | grep -E '^(packages|apps|templates)/[^/]+/' | cut -d/ -f1-2 | sort -u
)"

ok=true
results=""
log=""
for pkg in $changed; do
  [ -f "$root/$pkg/package.json" ] || continue
  out="$(cd "$root/$pkg" && pnpm run --if-present typecheck 2>&1 && pnpm run --if-present test 2>&1)"
  if [ $? -eq 0 ]; then s=true; else s=false; ok=false; log="$log
== $pkg ==
$(printf '%s' "$out" | tail -n 40)"; fi
  results="$results{\"package\":\"$pkg\",\"ok\":$s},"
done
results="[${results%,}]"

mkdir -p "$runs/$HACKKIT_EVENT"
status_file="$runs/$HACKKIT_EVENT/$HACKKIT_TASK.status.json"
printf '{"event":"%s","task":"%s","ok":%s,"packages":%s,"at":"%s"}\n' \
  "$HACKKIT_EVENT" "$HACKKIT_TASK" "$ok" "$results" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$status_file"

if [ "$ok" = false ] && [ "$active" != "true" ]; then
  printf 'on-stop: suíte vermelha; a tarefa só fecha com status verde.%s\n' "$log" >&2
  exit 2
fi
exit 0
