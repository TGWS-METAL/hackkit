# agent-scaffold

Submissão mínima para o harness `swegemma` (Gemma 4 Developer Agent, Kaggle) e um empacotador que valida a pasta e
gera o `submission.zip`. O resumo do harness está em [events/gemma4/HARNESS.md](../../events/gemma4/HARNESS.md).

```text
submission/
  agent.yaml            LlmAgent único, gemma-4-31b-it-qat-w4a16-ct, 6 ferramentas
  prompts/system.md     instrução (via !include)
  configs/sampling.yaml geração (via !include)
```

Este `agent.yaml` não tem `eval_config.yaml`, por isso valem os padrões do harness: 60 min, 100 chamadas e 500 turnos
por tarefa. Ele também não tem adapter nem sub-agente.

## Empacotar

```bash
pnpm --filter @hackkit/agent-scaffold build
node templates/agent-scaffold/dist/cli.js templates/agent-scaffold/submission -o submission.zip
```

Antes de gravar o zip, o empacotador confere as regras das seções 2.2, 2.4 e 3.2 do HARNESS_README. Com qualquer erro,
sai com código 1 e não grava nada:

- exatamente 1 config raiz;
- só as extensões aceitas;
- nenhum symlink;
- menos de 3 GiB e até 10.000 arquivos;
- `!include` dentro da raiz;
- um só modelo base, que esteja em `ALLOWED_MODEL_NAMES`;
- ferramentas que existam no harness;
- adapters em `adapters/<nome>/`;
- `max_output_tokens` e `thinking_budget` até 32.768.

Os arquivos ficam na raiz do zip, em ordem alfabética e com data fixa, então o mesmo conteúdo gera o mesmo zip.

## Rodar no PC

Fontes:
- notebook oficial: https://www.kaggle.com/code/ryanholbrook/getting-started-gemma-4-developer-agent
- dataset `metric/gemma-4-developer-agent-wheelhouse`: https://www.kaggle.com/datasets/metric/gemma-4-developer-agent-wheelhouse
- instalação do vLLM: https://docs.vllm.ai/en/stable/getting_started/installation/gpu/
- GPU no Docker Desktop: https://docs.docker.com/desktop/features/gpu/

Fatos dessas fontes, consultadas em 2026-11-02:

| fato | fonte |
|---|---|
| `swegemma`, `adk-submission` e `adk-eval-core` não estão no PyPI; os wheels estão no dataset acima (versão 31: swegemma 0.2.11, adk-submission 0.2.13, adk-eval-core 0.1.0, vllm 0.19.1, google_adk 1.36.1) | PyPI (404) e listagem do dataset |
| os wheels compilados são Linux x86_64 / CPython 3.12; o notebook roda Python 3.12.13 | listagem do dataset e metadado do notebook |
| o notebook instala com `pip install --no-deps --force-reinstall` todos os `.whl`, sobe o vLLM por `adk_submission.VllmServer` e avalia com `swegemma.evaluate.Evaluator` usando sandbox `subprocess` | notebook oficial |
| "vLLM does not support Windows natively"; no Windows, usar o WSL | docs do vLLM |
| GPU NVIDIA no Docker Desktop: "only available on Windows with the WSL 2 backend" | docs do Docker |

Este PC tem:
- RTX 5070 Ti com 16.303 MiB e driver 610.88;
- 31,1 GB de RAM e 32 threads;
- WSL 2 com Ubuntu, e Docker 29.6.1 com a distro `docker-desktop`.

O HARNESS_README estima 16–18 GB de pesos para o `gemma-4-31b-it-qat-w4a16-ct`, contra 16 GB de VRAM nesta placa. Para o
`gemma-4-12b-it-qat-w4a16-ct` a estimativa é 6–8 GB, e o 12b é o modelo padrão do notebook oficial. Para rodar o 12b
localmente, troque o `model:` do `agent.yaml` pelo 12b. A regra de modelo único vale por submissão.

Passos (dentro do Ubuntu do WSL). Nenhum deles foi executado nesta sessão:

```bash
# 1. Python 3.12 e venv
uv venv --python 3.12 ~/g4venv && source ~/g4venv/bin/activate

# 2. wheels do harness (dataset do Kaggle; usa o mesmo ~/.kaggle/kaggle.json)
kaggle datasets download metric/gemma-4-developer-agent-wheelhouse -p ~/g4wheels --unzip
uv pip install --no-deps ~/g4wheels/*.whl

# 3. dados da competição, já baixados no Windows
cd /mnt/c/Users/Pichau/Desktop/hackkit/events/gemma4/data

# 4. imagem do sandbox (se usar --sandbox docker)
docker build -f docker/Dockerfile.sandbox -t swebench-sandbox:latest docker

# 5. uma tarefa, para começar
swegemma eval --tasks tasks.jsonl --snapshots-dir snapshots \
  --submission-dir /mnt/c/Users/Pichau/Desktop/hackkit/templates/agent-scaffold/submission \
  --results-dir results/run_01 --sandbox docker --task-id fastapi_15661
```

Pontos não verificados:
- `--no-deps` pode deixar dependências de fora. O notebook monta o ambiente sobre a imagem do Kaggle, que já traz torch e
  outras bibliotecas.
- O notebook renomeia os wheels para `+cu128` e pula os de `cutlass`. O motivo não está documentado.
- Os pesos do Gemma vêm anexados ao notebook como modelo do Kaggle. O comando para baixá-los localmente não foi conferido.
- O `vllm 0.19.1` do wheelhouse não foi testado na RTX 5070 Ti.
- O `swegemma eval` sobe o vLLM sozinho a partir do alias. Mapear o alias para um endpoint próprio, via `--models-yaml`,
  depende do formato de `models.yaml`, que o HARNESS_README não descreve.

Para iterar sem GPU, use `--sandbox subprocess` com o agente apontando para outro endpoint compatível com OpenAI. Esse
caminho depende do mesmo `--models-yaml`.
