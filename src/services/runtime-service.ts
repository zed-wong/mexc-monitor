import type { RuntimeState } from '../core/types';
import type { RuntimeRepo } from '../db/repo/runtime-repo';

export class RuntimeService {
  constructor(private readonly repo: RuntimeRepo) {}

  getRuntime(): RuntimeState {
    return this.repo.get();
  }

  updateRuntime(runtime: RuntimeState): void {
    this.repo.update(runtime);
  }
}
