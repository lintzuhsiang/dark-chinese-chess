import { importTournament, MAX_FILE_BYTES, replayView, selectReplay } from './model';
import type { ReplayFile, SelectedReplay } from './model';
import type { ReplayRequest, ReplayResponse } from './protocol';

let file: ReplayFile | null = null;
let selected: SelectedReplay | null = null;
const reply = (message: ReplayResponse) => self.postMessage(message);
self.onmessage = async ({ data }: MessageEvent<ReplayRequest>) => {
  try {
    if (data.type === 'IMPORT') {
      file = null;
      selected = null;
      if (data.file.size > MAX_FILE_BYTES)
        throw new Error('File exceeds the 128 MiB import limit.');
      const start = performance.now();
      const bytes = await data.file.arrayBuffer();
      const reportSha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      file = importTournament(new TextDecoder().decode(bytes));
      reply({
        id: data.id,
        type: 'IMPORTED',
        reportSha256,
        matches: file.matches,
        warnings: file.warnings,
        durationMs: performance.now() - start,
      });
    } else {
      if (!file) throw new Error('Import a tournament first.');
      if (data.type === 'SELECT') selected = selectReplay(file, data.index, data.core);
      if (!selected) throw new Error('Select a match first.');
      reply({ id: data.id, type: 'VIEW', view: replayView(file, selected, data.ply) });
    }
  } catch (cause) {
    reply({
      id: data.id,
      type: 'ERROR',
      message: cause instanceof Error ? cause.message : 'Replay failed unexpectedly.',
    });
  }
};
