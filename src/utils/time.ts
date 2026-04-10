export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatTime(value?: string): string {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleTimeString();
}
