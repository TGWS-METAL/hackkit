// Interface Runner da seção 4 do plano.

export type ModelAlias = "opus" | "sonnet" | "haiku";

export interface Task {
  /** Identificador da tarefa, ex.: "frontend-001". */
  id: string;
  /** Slug do evento, ex.: "kiroween". */
  event: string;
  /** Concern do subagente, ex.: "frontend"; define a worktree wt/<evento>/<concern>. */
  concern: string;
  /** Texto da tarefa (conteúdo de tasks/<id>.md). */
  prompt: string;
  /** Prompt do agente (conteúdo de .claude/agents/<concern>.md), anexado ao system prompt. */
  agentPrompt?: string;
  allowedTools: string[];
  model: ModelAlias;
  maxTurns: number;
  /** Diretório onde o processo roda; padrão wt/<evento>/<concern>. */
  worktree?: string;
  /** Arquivo de saída; padrão runs/<evento>/<id>.jsonl. */
  outputFile?: string;
}

export interface TaskResult {
  status: "ok" | "failed" | "needs_human";
  turns: number;
  sessionId?: string;
  costUsd?: number;
}

export interface Runner {
  run(task: Task): Promise<TaskResult>;
}
