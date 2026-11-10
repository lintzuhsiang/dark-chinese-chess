import { describe, expect, it } from 'vitest';
import {
  applyAction,
  getLegalActions,
  getObservation,
  PIECE_DISTRIBUTION,
  type ActionEvent,
  type PieceColor,
  type PieceRank,
  type PlayerObservation,
} from '../../game-core/src/index';
import { deepFreeze, initialState, makeDeck } from '../../game-core/tests/fixtures';
import { createSeededRandom, getHiddenPieceDistribution } from '../src/index';

function distribution(observation: PlayerObservation, publicHistory: readonly ActionEvent[] = []) {
  return getHiddenPieceDistribution({ observation, publicHistory });
}

function capture(color: PieceColor, rank: PieceRank, ply: number): ActionEvent {
  return {
    type: 'MOVE',
    playerId: 'P1',
    ply,
    from: 0,
    to: 1,
    piece: { color: color === 'RED' ? 'BLACK' : 'RED', rank: 'CHARIOT' },
    captured: { color, rank },
  };
}

describe('public hidden-piece distribution', () => {
  it('uses color/rank counts, not uniform probabilities over the fourteen types', () => {
    const result = distribution(getObservation(initialState()));
    expect(result.totalHidden).toBe(32);
    expect(result.outcomes).toHaveLength(14);
    for (const outcome of result.outcomes) {
      expect(outcome.count).toBe(PIECE_DISTRIBUTION[outcome.piece.rank]);
      expect(outcome.probability).toBe(outcome.count / 32);
      expect(Object.keys(outcome.piece).sort()).toEqual(['color', 'rank']);
    }
    expect(result.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBe(1);
  });

  it('subtracts only captures and current reveals, without counting old FLIPs twice', () => {
    const board = [...getObservation(initialState()).board];
    board[0] = { kind: 'REVEALED', piece: { color: 'RED', rank: 'SOLDIER' } };
    board[1] = { kind: 'EMPTY' };
    const history: ActionEvent[] = [
      {
        type: 'FLIP',
        ply: 1,
        playerId: 'P1',
        position: 1,
        piece: { color: 'BLACK', rank: 'GENERAL' },
      },
      {
        type: 'FLIP',
        ply: 2,
        playerId: 'P2',
        position: 0,
        piece: { color: 'RED', rank: 'SOLDIER' },
      },
      capture('BLACK', 'GENERAL', 3),
    ];
    const result = distribution({ ...getObservation(initialState()), board }, history);
    expect(result.totalHidden).toBe(30);
    expect(result.outcomes).not.toContainEqual(
      expect.objectContaining({ piece: { color: 'BLACK', rank: 'GENERAL' } }),
    );
    expect(result.outcomes).toContainEqual({
      piece: { color: 'RED', rank: 'SOLDIER' },
      count: 4,
      probability: 4 / 30,
    });
    expect(result.outcomes.reduce((sum, outcome) => sum + outcome.count, 0)).toBe(30);
    expect(result.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1);
  });

  it('returns an empty distribution without division by zero when nothing is hidden', () => {
    const state = initialState();
    const observation: PlayerObservation = {
      ...getObservation(state),
      board: state.board.map((square) => {
        if (square === null) throw new Error('Initial fixture must be full.');
        return {
          kind: 'REVEALED',
          piece: { color: square.piece.color, rank: square.piece.rank },
        };
      }),
    };
    expect(distribution(observation)).toEqual({ totalHidden: 0, outcomes: [] });
  });

  it('rejects missing inventory, excess captures/reveals, and an invalid board size', () => {
    const observation = getObservation(initialState());
    expect(() => distribution({ ...observation, board: observation.board.slice(1) })).toThrow(
      '32 squares',
    );
    const board = [...observation.board];
    board[0] = { kind: 'EMPTY' };
    expect(() => distribution({ ...observation, board })).toThrow('conserve');
    expect(() =>
      distribution(observation, [capture('RED', 'GENERAL', 1), capture('RED', 'GENERAL', 2)]),
    ).toThrow('initial piece distribution');
    board[0] = { kind: 'REVEALED', piece: { color: 'RED', rank: 'GENERAL' } };
    board[1] = { kind: 'REVEALED', piece: { color: 'RED', rank: 'GENERAL' } };
    expect(() => distribution({ ...observation, board })).toThrow('initial piece distribution');
    expect(() => distribution({ ...observation, board }, [capture('RED', 'GENERAL', 1)])).toThrow(
      'initial piece distribution',
    );
  });

  it('is independent of actual hidden identities, internal IDs, turn, and player colors', () => {
    const deck = makeDeck();
    const first = getObservation(initialState(deck));
    const second = getObservation(
      initialState([...deck].reverse().map((piece, index) => ({ ...piece, id: `other-${index}` }))),
    );
    expect(distribution(first)).toEqual(distribution(second));
    expect(distribution(first)).toEqual(
      distribution({ ...second, currentPlayer: 'P2', playerColors: { P1: 'BLACK', P2: 'RED' } }),
    );
  });

  it('accepts frozen public input and returns detached, reproducible results', () => {
    const input = deepFreeze({ observation: getObservation(initialState()), publicHistory: [] });
    const before = JSON.stringify(input);
    const first = getHiddenPieceDistribution(input);
    const second = getHiddenPieceDistribution(input);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.outcomes[0]!.piece).not.toBe(second.outcomes[0]!.piece);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('conserves each type at every prefix of actual Core games, including captures', () => {
    let captures = 0;
    let reveals = 0;
    for (let seed = 0; seed < 4; seed += 1) {
      const random = createSeededRandom(seed);
      let state = initialState();
      const publicHistory: ActionEvent[] = [];
      for (let ply = 0; ply < 200; ply += 1) {
        const result = distribution(getObservation(state), publicHistory);
        const hidden = state.board.filter((square) => square && !square.revealed);
        expect(result.totalHidden).toBe(hidden.length);
        expect(result.outcomes.reduce((sum, outcome) => sum + outcome.count, 0)).toBe(
          hidden.length,
        );
        expect(result.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(
          hidden.length === 0 ? 0 : 1,
        );
        for (const color of ['RED', 'BLACK'] as const) {
          for (const rank of Object.keys(PIECE_DISTRIBUTION) as PieceRank[]) {
            const actual = hidden.filter(
              (square) => square?.piece.color === color && square.piece.rank === rank,
            ).length;
            const publicCount = result.outcomes.find(
              (outcome) => outcome.piece.color === color && outcome.piece.rank === rank,
            )?.count;
            expect(publicCount ?? 0).toBe(actual);
          }
        }
        if (state.status === 'FINISHED') break;
        const actions = getLegalActions(state, state.currentPlayer);
        const accepted = applyAction(
          state,
          state.currentPlayer,
          actions[Math.floor(random() * actions.length)]!,
        );
        if (!accepted.ok) throw new Error(accepted.error.code);
        state = accepted.state;
        publicHistory.push(accepted.event);
        if (accepted.event.type === 'FLIP') reveals += 1;
        else if (accepted.event.captured !== null) captures += 1;
      }
    }
    expect(captures).toBeGreaterThan(0);
    expect(reveals).toBeGreaterThan(0);
  });
});
