import { describe, expect, it } from 'vitest';
import { BALANCE, FINAL, GOALS } from '../core/index';
import { simulate } from './simulate';

describe('マイルストーン6の調整値', () => {
  it('シミュレータで決めた値になっている', () => {
    // test-setup.ts がルールのテスト用に AP を3へ戻すので、元の値は data.ts の初期値で確かめる
    expect(GOALS).toMatchObject({ warPoints: 6, healsNeeded: 3, exploreRatio: { small: 0.25, medium: 0.2, large: 0.15 }, specialsNeeded: 2, courseGenres: 4, lordCeiling: 10, lordHoldTurns: 4, fortHoldTurns: 3 });
    expect(FINAL).toMatchObject({ sinkEveryTurns: 2, stormDamage: 0, attackBonus: 2 });
  });

  it('CPUだけの対戦がすべて決着し、特殊勝利と最後の1人の両方が起きる', () => {
    BALANCE.apPerTurn = 4;
    const report = simulate({ games: 60, players: [3, 4, 5], sizes: ['small', 'medium'], levels: ['normal', 'hard'], seedPrefix: 'test' });
    expect(report.unfinished).toBe(0);
    expect(report.reasons.lastStanding ?? 0).toBeGreaterThan(0);
    expect(report.games - (report.reasons.lastStanding ?? 0) - (report.reasons.nobody ?? 0)).toBeGreaterThan(0);
  });
});
