# hackkit

Kit para competir em hackathons com agentes: cada evento é um `events/<evento>/spec.yaml`, e os
critérios de julgamento viram verificadores executáveis.

Requisitos: Node.js 24+, pnpm 12, Git Bash (no Windows, para os hooks).

```bash
pnpm install
pnpm build
pnpm test
```

## Pacotes

| pacote | conteúdo |
|---|---|
| `packages/spec-runner` | lê `spec.yaml`, roda os verificadores `command`, `file_exists` e `e2e`, devolve nota por critério, total ponderado 0–100 e lacunas abaixo de 0,85 |
| `packages/orchestrator` | interface `Runner` e o runner `cli` (`claude -p` por tarefa, saída em `runs/<evento>/<tarefa>.jsonl`) |
| `packages/ledger` | SQLite (`node:sqlite`) com a tabela `participations` |
| `scripts/hooks` | hooks do Claude Code: `post-edit.sh`, `guard-bash.sh`, `on-stop.sh` |

```bash
node packages/spec-runner/dist/cli.js events/<evento>/spec.yaml --base-url https://<preview>
```

Modo do runner: `hackkit.config.json` (`{"runner": "cli"}`) ou a variável `HACKKIT_RUNNER`.

## Uso de IA

Este repositório é construído com o Claude Code. O kit é aberto (licença MIT) e anterior aos eventos;
o código de cada evento fica em `apps/<evento>`.
