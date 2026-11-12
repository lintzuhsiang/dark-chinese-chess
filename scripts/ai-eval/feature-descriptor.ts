import { progressAgent, type GameAgent } from '../../packages/ai-agents/src/index';
import { tacticalDescriptor } from './tactical-descriptor';
import type { EvaluatedAgent } from './tournament-types';

export function progressDescriptor(id: string, policy: GameAgent = progressAgent): EvaluatedAgent {
  const base = tacticalDescriptor(id, policy);
  return {
    ...base,
    implementation: 'progress-6b-v1',
    configuration: {
      ...base.configuration,
      progress: { startQuietPly: 40, limit: 60, component: 'material-only' },
    },
    sourcePaths: [...base.sourcePaths, 'packages/ai-agents/src/progress-agent.ts'],
  };
}
