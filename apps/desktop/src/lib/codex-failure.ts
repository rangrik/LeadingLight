type Failure = { turnId: string; message: string };

export function codexFailure(params: { turnId?: unknown; willRetry?: unknown; error?: { message?: unknown } }): Failure | undefined {
  if (params.willRetry !== false || typeof params.turnId !== "string" || typeof params.error?.message !== "string" || !params.error.message.trim()) return;
  return { turnId: params.turnId, message: params.error.message };
}

export function codexFailureMessage(turn: { id?: string; error?: { message?: string } } | undefined, failure?: Failure): string {
  return turn?.error?.message || (turn?.id === failure?.turnId ? failure?.message : undefined) || "Codex couldn't finish";
}
