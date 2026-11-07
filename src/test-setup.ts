// ルールの仕組みのテストは、調整で変わる1ターンのAPに引きずられないよう、元の3で確かめる。
// 今の調整値そのものは balance.test.ts で確かめる。
import { beforeEach } from 'vitest';
import { BALANCE } from './core/index';

beforeEach(() => {
  BALANCE.apPerTurn = 3;
});
