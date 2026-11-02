#!/usr/bin/env bash
# PreToolUse em Bash (seção 7): bloqueia rm -rf, push forçado na branch do evento
# e acesso a .env de produção. Exit 2 bloqueia a chamada; o stderr volta ao agente.
set -u
HOOK_INPUT="$(cat)"
. "$(dirname "$0")/lib.sh"

cmd="$(json_field tool_input.command)"
[ -z "$cmd" ] && exit 0

block() {
  echo "guard-bash: bloqueado — $1" >&2
  exit 2
}

# rm com recursivo e forçado juntos: -rf, -fr, -r -f, --recursive --force (qualquer ordem).
while IFS= read -r part; do
  set -- $part
  [ "${1:-}" = "sudo" ] && shift
  [ "${1:-}" = "rm" ] || continue
  shift
  r=0 f=0
  for a in "$@"; do
    case "$a" in
      --recursive) r=1 ;;
      --force) f=1 ;;
      --*) ;;
      -*) [[ "$a" == *[rR]* ]] && r=1; [[ "$a" == *f* ]] && f=1 ;;
    esac
  done
  [ $r = 1 ] && [ $f = 1 ] && block "rm -rf"
done < <(printf '%s\n' "$cmd" | sed -E 's/(&&|\|\||;|\|)/\n/g')

# Push forçado na branch do evento. A branch vem de HACKKIT_EVENT_BRANCH;
# sem a variável, a branch do evento não é conhecida e este item não bloqueia.
if [ -n "${HACKKIT_EVENT_BRANCH:-}" ] && printf '%s' "$cmd" | grep -Eq 'git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?[[:space:]]+push'; then
  if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(-f|--force|--force-with-lease(=[^[:space:]]*)?|--force-if-includes)([[:space:]]|$)|[[:space:]]\+[^[:space:]]+'; then
    current="$(git -C "$(json_field cwd)" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    if printf '%s' "$cmd" | grep -Eq "(^|[[:space:]:+])${HACKKIT_EVENT_BRANCH}([[:space:]]|$)" \
      || [ "$current" = "$HACKKIT_EVENT_BRANCH" ]; then
      block "push forçado na branch do evento ($HACKKIT_EVENT_BRANCH)"
    fi
  fi
fi

# .env de produção: .env.production, .env.prod, .env.production.local etc.
if printf '%s' "$cmd" | grep -Eq '\.env\.prod(uction)?([.[:space:]"'"'"']|$)'; then
  block "acesso a .env de produção"
fi

exit 0
