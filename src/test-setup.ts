// ルールの仕組みのテストは、調整で変わる値に引きずられないようにそろえて動かす。
// 今の調整値そのものは src/sim/simulate.test.ts で確かめる。
import { beforeEach } from 'vitest';
import { BALANCE, CATCH_UP } from './core/index';

/** 最下位の救済の本来の確率。専用のテストで使う */
export const CATCH_UP_CHANCE = CATCH_UP.chance;

beforeEach(() => {
  BALANCE.apPerTurn = 3;
  // 最下位の救済は乱数で物が増えるので止める
  CATCH_UP.chance = 0;
});
