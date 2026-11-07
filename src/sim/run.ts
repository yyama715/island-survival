// 使い方: npm run sim -- --games 3000 --ap 4 --level hard --set GOALS.warPoints=6
import {
  BALANCE,
  COMBAT,
  DEPLETION,
  FATIGUE,
  FINAL,
  GOALS,
  RECIPES,
  type ItemId,
  type RecipeId,
  SMOKE,
  WEATHER,
  type CpuLevel,
  type MapSize,
} from '../core/index';
import { formatReport, simulate } from './simulate';

const TABLES: Record<string, Record<string, unknown>> = { BALANCE, COMBAT, DEPLETION, FATIGUE, FINAL, GOALS, SMOKE, WEATHER };

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [path, value] = args[i + 1].split('=');
  const [table, key] = path.split('.');
  if (!TABLES[table] || !(key in TABLES[table])) throw new Error(`知らない数値です: ${path}`);
  TABLES[table][key] = Number(value);
}
// --recipe fort=wood:6,stone:3,rope:1
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--recipe') continue;
  const [id, list] = args[i + 1].split('=');
  if (!Object.hasOwn(RECIPES, id)) throw new Error(`知らないレシピです: ${id}`);
  RECIPES[id as RecipeId].inputs = [list.split(',').map((pair) => ({ item: pair.split(':')[0] as ItemId, count: Number(pair.split(':')[1]) }))];
}
if (option('ap')) BALANCE.apPerTurn = Number(option('ap'));

const games = Number(option('games') ?? 300);
const report = simulate({
  games,
  players: (option('players') ?? '3,4,5').split(',').map(Number),
  sizes: (option('sizes') ?? 'small,medium,large').split(',') as MapSize[],
  levels: (option('level') ?? 'normal,hard').split(',') as CpuLevel[],
  seedPrefix: option('seed') ?? 'sim',
});
console.log(formatReport(report));
if (option('json')) console.log(JSON.stringify(report));
