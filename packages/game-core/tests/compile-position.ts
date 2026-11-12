/** Test-only cooperative reverse setup. Every returned prefix is replayed by real Core. */
import {
  applyAction,
  createInitialState,
  type GameAction,
  type GameState,
  type Piece,
  type PlayerColors,
  type PlayerId,
  type Square,
} from '../src/index';
import { getActionError } from '../src/validation';
const boardKey = (b: readonly Square[]) =>
  JSON.stringify(
    b.map((s) => (s === null ? null : [s.revealed, s.piece.id, s.piece.color, s.piece.rank])),
  );
const cache = new Map<string, { deck: readonly Piece[]; actions: readonly GameAction[] }>();
const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');
const value = { GENERAL: 10, CANNON: 9, ADVISOR: 8, ELEPHANT: 7, CHARIOT: 6, HORSE: 5, SOLDIER: 4 };
export function compilePosition(
  target: readonly Square[],
  captured: readonly Piece[],
  currentPlayer: PlayerId,
  playerColors: PlayerColors,
): {
  state: GameState;
  history: import('../src/types').ActionEvent[];
  initialDeck: readonly Piece[];
} {
  const key = JSON.stringify([target, currentPlayer, playerColors]);
  function replay(deck: readonly Piece[], actions: readonly GameAction[]) {
    const initial = createInitialState(deck);
    if (!initial.ok) throw Error('Invalid compiled deck');
    let state = initial.state;
    const history = [];
    for (const action of actions) {
      const next = applyAction(state, state.currentPlayer, action);
      if (!next.ok) return null;
      state = next.state;
      history.push(next.event);
    }
    // Keep the replay-derived v4 ledger: a final capture/FLIP resets only the quiet counter.
    if (
      state.status !== 'ACTIVE' ||
      state.noProgressCount !== 0 ||
      state.currentPlayer !== currentPlayer ||
      state.playerColors.P1 !== playerColors.P1 ||
      boardKey(state.board) !== boardKey(target)
    )
      return null;
    return { state, history, initialDeck: deck.map((p) => ({ ...p })) };
  }
  const saved = cache.get(key);
  if (saved) {
    const f = replay(saved.deck, saved.actions);
    if (!f) throw Error('Invalid cached fixture');
    return f;
  }
  for (let attempt = 1; attempt <= 1200; attempt++) {
    let random = attempt;
    const pick = (n: number) => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random % n;
    };
    let board = [...target],
      stock = [...captured],
      turn = currentPlayer;
    const reverse: GameAction[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < 240 && stock.length > 0; step++) {
      const actor = other(turn),
        color = playerColors[actor];
      const holes = board.flatMap((s, i) => (s === null ? [i] : []));
      const movers = board.flatMap((s, i) => (s?.revealed && s.piece.color === color ? [i] : []));
      const caps: { board: Square[]; action: GameAction; index: number; score: number }[] = [];
      const unique = new Set<string>();
      for (let i = 0; i < stock.length; i++) {
        const capturedPiece = stock[i]!;
        const rankKey = capturedPiece.color + capturedPiece.rank;
        if (capturedPiece.color === color || unique.has(rankKey)) continue;
        unique.add(rankKey);
        for (const from of holes)
          for (const to of movers) {
            const previous = [...board];
            previous[from] = board[to]!;
            previous[to] = { piece: capturedPiece, revealed: true };
            const action: GameAction = { type: 'MOVE', from, to };
            if (
              getActionError(
                { board: previous, currentPlayer: actor, playerColors, status: 'ACTIVE' },
                actor,
                action,
              ) === null
            )
              caps.push({ board: previous, action, index: i, score: value[capturedPiece.rank] });
          }
      }
      // An inverse capture/FLIP at the final position guarantees a zero quiet counter.
      const desiredParity = currentPlayer === 'P1' ? 0 : 1;
      const revealed = board.filter((s) => s?.revealed).length;
      const avoidLast = stock.length === 1 && (reverse.length + revealed) % 2 !== desiredParity;
      if (caps.length && !avoidLast) {
        caps.sort((a, b) => b.score - a.score);
        const best = caps.filter((c) => c.score >= caps[0]!.score - 1);
        const c = best[pick(best.length)]!;
        board = c.board;
        stock.splice(c.index, 1);
        reverse.push(c.action);
        turn = actor;
        continue;
      }
      const quiet: { board: Square[]; action: GameAction }[] = [];
      if (step > 0)
        for (const from of holes)
          for (const to of movers) {
            const previous = [...board];
            previous[from] = board[to]!;
            previous[to] = null;
            const action: GameAction = { type: 'MOVE', from, to };
            if (
              getActionError(
                { board: previous, currentPlayer: actor, playerColors, status: 'ACTIVE' },
                actor,
                action,
              ) === null &&
              !seen.has(JSON.stringify([previous, actor]))
            )
              quiet.push({ board: previous, action });
          }
      if (quiet.length) {
        const q = quiet[pick(quiet.length)]!;
        board = q.board;
        reverse.push(q.action);
        turn = actor;
        seen.add(JSON.stringify([board, turn]));
        continue;
      }
      // A reverse FLIP is a legal cooperative tempo; retain a first-flip-color reserve.
      const reds = board.filter((s) => s?.revealed && s.piece.color === playerColors.P1).length;
      const flips = board.flatMap((s, i) =>
        s?.revealed &&
        !(
          s.piece.color === playerColors.P1 &&
          reds === 1 &&
          !stock.some((p) => p.color === playerColors.P1)
        )
          ? [i]
          : [],
      );
      if (!flips.length) break;
      const pos = flips[pick(flips.length)]!;
      board[pos] = { ...board[pos]!, revealed: false };
      reverse.push({ type: 'FLIP', position: pos });
      turn = actor;
    }
    if (stock.length) continue;
    const revealed = board.flatMap((s, i) => (s?.revealed ? [i] : []));
    if ((reverse.length + revealed.length) % 2 !== (currentPlayer === 'P1' ? 0 : 1)) continue;
    const last = revealed.find((i) => board[i]!.piece.color === playerColors.P1);
    if (last === undefined) continue;
    for (const pos of [...revealed.filter((i) => i !== last), last]) {
      board[pos] = { ...board[pos]!, revealed: false };
      reverse.push({ type: 'FLIP', position: pos });
    }
    const deck = board.map((s) => s!.piece),
      actions = reverse.reverse();
    const fixture = replay(deck, actions);
    if (fixture) {
      cache.set(key, { deck, actions });
      return fixture;
    }
  }
  throw Error('Could not compile tactical position into a valid accepted prefix: ' + key);
}
