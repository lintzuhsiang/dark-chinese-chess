import type { CoreIdentity, MatchSummary, ReplayView } from './model';

export type ReplayRequest =
  | { readonly id: number; readonly type: 'IMPORT'; readonly file: File }
  | {
      readonly id: number;
      readonly type: 'SELECT';
      readonly index: number;
      readonly ply: number;
      readonly core: CoreIdentity;
    }
  | { readonly id: number; readonly type: 'SEEK'; readonly ply: number };

export type ReplayResponse =
  | {
      readonly id: number;
      readonly type: 'IMPORTED';
      readonly reportSha256: string;
      readonly matches: readonly MatchSummary[];
      readonly warnings: readonly string[];
      readonly durationMs: number;
    }
  | { readonly id: number; readonly type: 'VIEW'; readonly view: ReplayView }
  | { readonly id: number; readonly type: 'ERROR'; readonly message: string };
