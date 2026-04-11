import type { RuntimeScope, RuntimeState, ScopedRuntimeState } from '../core/types';
import type { RuntimeRepo } from '../db/repo/runtime-repo';

export class RuntimeService {
  constructor(private readonly repo: RuntimeRepo) {}

  getRuntime(scope: RuntimeScope): RuntimeState {
    return this.repo.get(scope);
  }

  updateRuntime(scope: RuntimeScope, runtime: RuntimeState): void {
    this.repo.update(scope, runtime);
  }

  listRuntime(filter?: Partial<RuntimeScope>): ScopedRuntimeState[] {
    return this.repo.list(filter);
  }
}
