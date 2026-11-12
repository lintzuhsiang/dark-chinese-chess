import {
  progressAgent,
  createStrategicAgent,
  STRATEGIC_PRESETS,
  STRATEGIC_FEATURE_WEIGHT,
  type StrategicFeatures,
  type GameAgent,
} from '../../packages/ai-agents/src/index';
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

export function strategicDescriptor(
  id: string,
  feature: keyof StrategicFeatures,
  policy: GameAgent = createStrategicAgent(STRATEGIC_PRESETS[feature]),
): EvaluatedAgent {
  const base = progressDescriptor(id, policy);
  return {
    ...base,
    implementation: 'strategic-6c-' + feature + '-v1',
    configuration: {
      ...base.configuration,
      strategic: { ...STRATEGIC_PRESETS[feature] },
      strategicWeight: STRATEGIC_FEATURE_WEIGHT,
    },
    sourcePaths: [...base.sourcePaths, 'packages/ai-agents/src/strategic-agent.ts'],
  };
}
