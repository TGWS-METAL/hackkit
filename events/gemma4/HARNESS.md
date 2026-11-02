# Harness `swegemma`: resumo

Fonte: `HARNESS_README.md` dos dados da competição (55.940 bytes, criado em 2026-10-13). O resumo cita as seções
do original (§). Os dados não vão para o repositório (`events/gemma4/data/` está no `.gitignore`).

## Pilha

| pacote | papel |
|---|---|
| `adk-submission` | compila a pasta da submissão (YAML) numa árvore de agentes do Google ADK sem executar Python do competidor; sobe o vLLM local |
| `adk-eval-core` | sandboxes (Docker ou subprocess), edição de arquivo em 3 níveis, orçamento de tokens, plugins do ADK, trace ATIF v1.7 |
| `swegemma` | ciclo de avaliação estilo SWE-bench (contêiner A do agente, contêiner B de verificação), as 9 ferramentas, extração do patch, `pytest` + JUnit |

Métrica: **taxa de resolução** = tarefas resolvidas / tarefas do split, entre 0 e 1 (§8.2). Uma tarefa conta como
resolvida quando o `pytest` sai com código 0 e o JUnit XML tem `passed_tests > 0`, `failures == 0` e `errors == 0`. Além
disso, todo teste exigido precisa ter passado sem ser pulado.

## `agent.yaml` (ADK declarativo, §2)

Layout da pasta. Ela vai na raiz do `submission.zip`:

```text
agent.yaml            obrigatório; exatamente 1 entre agent.yaml, agent.yml, root_agent.yaml, root_agent.yml
eval_config.yaml      opcional (orçamentos por tarefa)
configs/*.yaml        opcional, via !include
prompts/*.md          opcional, via !include
sub_agents/*.yaml     opcional
adapters/<nome>/      opcional: adapter_config.json + adapter_model.safetensors (LoRA PEFT)
skills/<nome>/SKILL.md opcional
```

- O compilador é só YAML: não existe `agent.py`, e não se usa `importlib`.
- `!include <caminho relativo>`:
  - `.md` e `.txt` entram como texto.
  - `.yaml` e `.yml` são lidos recursivamente, até profundidade 10, com detecção de ciclo.
  - São bloqueados: caminho absoluto, byte nulo e symlink que aponte para fora da raiz.
  - O texto diz que `..` é bloqueado, mas o `sub_agents/code_analyzer.yaml` do `sample_submission` usa
    `!include ../prompts/analyzer.md`. O validador do kit aceita `..` desde que o caminho resolvido fique dentro da raiz.
- `agent_class`:
  - `LlmAgent` (padrão), com os campos `name`, `model`, `adapter`, `description`, `instruction`, `tools`, `skills`,
    `sub_agents`, `output_key`, `include_contents`, `disallow_transfer_to_parent`/`_peers` e `generate_content_config`.
  - `SequentialAgent`, `ParallelAgent` e `LoopAgent` (`max_iterations` de 1 a 500).
- Item de `tools` pode ser:
  - o nome de uma ferramenta;
  - `agent_tool: {config_path, skip_summarization}`;
  - um agente inline.
- `instruction` aceita `{problem_description}` e `{hints}`, que vêm do estado da sessão.
- Modelo (§3):
  - Uma submissão usa **um só modelo base**. O prefixo `openai/`, `google/`, `hosted_vllm/` ou `custom/` é removido antes
    da comparação.
  - O modelo tem que estar em `ALLOWED_MODEL_NAMES`: `gemma-4-31b-it-qat-w4a16-ct`, `gemma-4-12b-it-qat-w4a16-ct`,
    `gemma-4-e4b-it-qat-w4a16-ct` ou `gemma-4-e2b-it-qat-w4a16-ct`.
  - Agentes diferentes podem usar adapters LoRA diferentes sobre o mesmo modelo base.
- Limites (§2.4):
  - Tamanho descompactado **< 3 GiB** (3.221.225.472 bytes), contando `adapters/`.
  - Até 10.000 arquivos, 1.000 YAMLs e 50 MiB por YAML.
  - Até 1.000.000 caracteres de instrução por agente e 500 agentes.
  - Extensões aceitas: `.yaml .yml .md .txt .py .json .safetensors`.
- `generate_content_config`:
  - `max_output_tokens` de 1 a 32.768 (padrão 16.384).
  - `thinking_config.thinking_budget` de 0 a 32.768 (padrão 4.096).
  - Com vLLM e LoRA, use `include_thoughts: true` e `thinking_budget`, e não `thinking_level`.
  - Os campos `tools`, `system_instruction`, `http_options`, `safety_settings` e `response_schema` dão erro de validação.

## Ambiente de avaliação (§3.1, §4.1)

| item | valor |
|---|---|
| GPU | 4 × NVIDIA L4, 24 GB cada (96 GB) |
| vLLM | `tensor_parallel_size=4`, `gpu_memory_utilization=0.90`, `max_model_len=32768`, `tool_call_parser=gemma4`, `reasoning_parser=gemma4`, em `127.0.0.1:8000/v1` |
| LoRA | `max_lora_rank` = maior rank encontrado (128 se não houver) |
| contêiner por tarefa | imagem `swebench-sandbox:latest`, `network_mode="none"`, 4 GiB de RAM (exit 137 acima disso), 2 vCPUs, `/workspace` |
| repositório | snapshot em `base_commit`, sem nenhum commit posterior no `.git`; commit `baseline` já inclui `pytest.ini` e `conftest.py` do harness |

## Ferramentas (§6)

| ferramenta | conta no orçamento | o que faz |
|---|---|---|
| `run_command(command)` | sim | `bash -c` em `/workspace`; timeout `min(300 s, tempo restante)`; stdout/stderr cortados em 5.000 caracteres; timeout não encerra a sessão |
| `submit_patch()` | não | `git add -N .` + `git diff --binary`; marca o patch como enviado; o loop termina ao fim do turno |
| `get_status()` | não | chamadas usadas/restantes, tempo restante, patch enviado |
| `read_file(filepath, start_line, end_line)` | sim | até 150 linhas e 10.000 caracteres por chamada |
| `edit_file(filepath, old_string, new_string, allow_multiple)` | sim | troca em 3 níveis: exata, por linha sem espaços, regex; erro se houver mais de 1 ocorrência sem `allow_multiple` |
| `write_file(filepath, content)` | sim | cria ou sobrescreve, com `mkdir -p` |
| `get_code_neighbors(node, edge_type, max_neighbors)` | sim | vizinhos no grafo de chamadas pré-calculado (`graphs/<repo>.json`) |
| `search_similar_code(query, k)` | sim | similaridade de cosseno nos embeddings pré-calculados (`embeddings/<repo>.npz`), sem servidor de embedding |
| `get_code_subgraph(nodes)` | sim | subgrafo induzido por uma lista de símbolos |

- Ferramenta não declarada ou com exceção volta ao modelo como `{"status":"error",...}`, sem abortar a tarefa.
- Com `tool_calls >= 20`, toda resposta traz `budget_warning` quando restam 10 chamadas ou menos.
- Turno que termina sem `submit_patch` gera uma mensagem de continuação. Depois de 3 mensagens seguidas sem nenhuma
  chamada de ferramenta, o loop para (§5.3).
- Sem `submit_patch`, o harness extrai o diff sozinho e esse diff também é avaliado (§8.1).
- O patch perde, ao ser extraído, os trechos que tocam:
  - testes: `test_*.py`, `*_test.py`, e `.py` em `tests/`, `test/` ou `testing/`;
  - configuração do runner: `conftest.py`, `pytest.ini`, `pyproject.toml`, `tox.ini`, `setup.cfg`, `*.pth` etc.
- Arquivo novo em `/workspace`, por exemplo `repro.py`, entra no patch. Rascunho vai em `/tmp`.

## Limites de tempo e orçamento (§7.1)

| parâmetro | padrão em `inference.py` | `sample_submission` | chave do `eval_config.yaml` | variável de ambiente |
|---|---|---|---|---|
| tempo por tarefa (loop do agente) | 60 min | 1 min | `evaluation.max_time_minutes` | `SWE_MAX_TIME_MINUTES` |
| chamadas de ferramenta | 100 (`None` no CLI) | 10 | `evaluation.max_tool_calls` | `SWE_MAX_TOOL_CALLS` |
| turnos do LLM | 500 | 50 | `evaluation.max_turns` | `SWE_MAX_TURNS` / `SWE_MAX_LOOP_ITERATIONS` |
| timeout de um comando (fase 1) | 300 s | 60 s | `evaluation.timeout_seconds` | `SWE_TIMEOUT_SECONDS` |
| timeout do `pytest` (fase 2) | 300 s, fixo no avaliador | — | — | `SWE_TIMEOUT_SECONDS` (`metric.py`) |
| saída de comando / diff / grafo | 5.000 caracteres | — | — | — |

- Página oficial da competição (overview e data, consultadas em 2026-11-02):
  - "Your agent has a limit of 12 hours to submit patches for all tasks." É o limite total, somando todas as tarefas.
  - Internet desligada.
  - O conjunto de teste tem cerca de 120 tarefas, "evenly divided between the public and private splits".
- A montagem do contêiner não conta no tempo do agente.
- Compactação de contexto do ADK (§7.2):
  - `compaction_interval=15`, `overlap_size=2`, `token_threshold=14336`, `event_retention_size=5`.
  - Cache de contexto com `min_tokens=2048` e `ttl_seconds=1800`.
- Erros 429/5xx do modelo são repetidos até 5 vezes, com backoff de 2 s a 60 s.

## `eval_config.yaml`

```yaml
evaluation:
  timeout_seconds: 300     # por comando
  max_tool_calls: 100
  max_time_minutes: 60
  max_turns: 500
```

O arquivo é opcional. Sem ele, valem os padrões de `inference.py`. O `sample_submission` traz `60 / 10 / 1 / 50`
(timeout_seconds, max_tool_calls, max_time_minutes, max_turns). O `agent-scaffold` do kit não inclui este arquivo.

## Dados (`events/gemma4/data/`, fora do git)

| pasta | conteúdo |
|---|---|
| `tasks.jsonl` | 129 tarefas: 67 fastapi/fastapi, 48 Textualize/rich, 13 psf/requests, 1 encode/httpx. Campos: `instance_id`, `repo`, `base_commit`, `created_at`, `problem_statement`, `hints_text`, `patch` (gabarito), `test_patch` |
| `snapshots/` | 129 `.tgz`, um por tarefa (21.497 MB no total) |
| `graphs/`, `embeddings/` | 127 + 127 arquivos para as ferramentas de código (422 MB + 468 MB) |
| `wheels/` | 124 wheels de dependências de teste (28 MB) |
| `docker/` | `Dockerfile.sandbox`, `Dockerfile.public` (python:3.13-slim + git, patch, pytest, `pytest-timeout==2.1.0`; o `.public` copia `wheels/`), `imp.py`, `telnetlib.py` |
| `sandbox/setup.py` | instalação rápida das dependências de teste no contêiner |
| `sample_submission/` | `agent.yaml` com 31B + adapter `main_lora`, sub-agente `code_analyzer` com `tool_lora` como `agent_tool`, 9 ferramentas, `eval_config.yaml` |

## Como testar localmente (§9)

```bash
swegemma eval \
  --tasks tasks.jsonl \
  --snapshots-dir snapshots \
  --submission-dir <pasta da submissão> \
  --results-dir results/run_01 \
  --sandbox docker \
  --concurrency 2
```

- Flags:
  - `--task-id <id>` / `--task-ids ...`
  - `--sandbox docker|subprocess`
  - `--timeout-seconds`, `--verification-timeout-seconds`
  - `--max-tool-calls`, `--max-time-minutes`
  - `--shard-index k --num-shards M`
  - `--models-yaml <arquivo>`, que mapeia aliases para endpoints e preços
  - `--skip-agent-patch`, que roda só a fase 2 com patch vazio para conferir que o teste falha sem correção
- Saída em `--results-dir`:
  - `summary.json`, com taxa de resolução e quebra por repositório;
  - `task_results.jsonl`;
  - `patches/<id>.patch`;
  - `test_outputs/<id>.log`, a saída do pytest da fase 2;
  - `traces/trace_<id>.json`;
  - `logs/<id>.log`.

Instalação do `swegemma` e execução no PC: ver a seção "Rodar no PC" de `templates/agent-scaffold/README.md`.
