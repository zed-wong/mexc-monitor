import type { AppState, EventLog, RuntimeState, WithdrawHistoryItem } from './types';

type Listener = (state: AppState) => void;

export class StateStore {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(initialState: AppState) {
    this.state = initialState;
  }

  getState(): AppState {
    return this.state;
  }

  setState(partial: Partial<AppState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  setRuntime(runtime: RuntimeState): void {
    this.setState({ runtime });
  }

  setLogs(recentLogs: EventLog[]): void {
    this.setState({ recentLogs });
  }

  setHistory(recentHistory: WithdrawHistoryItem[]): void {
    this.setState({ recentHistory });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
