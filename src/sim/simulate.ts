// 10.3 自動対戦。CPUだけで最後まで遊び、勝ち方や職業ごとの勝率を集める。
import {
  createDraft,
  createGame,
  exploreTarget,
  FOOD_GENRES,
  GOALS,
  ITEM_GENRE,
  type PlayerState,
  draftAuto,
  finishDraft,
  getPlayerView,
  ghostPlanForCpu,
  planForCpu,
  resolveTurn,
  Rng,
  type CpuLevel,
  type GameState,
  type JobId,
  type MapSize,
  type PlanAction,
  type TraitId,
  type VictoryReason,
} from '../core/index';

export interface SimOptions {
  games: number;
  players: number[];
  sizes: MapSize[];
  levels: CpuLevel[];
  seedPrefix: string;
}

export interface SimReport {
  games: number;
  unfinished: number;
  reasons: Partial<Record<VictoryReason | 'nobody', number>>;
  /** 最後の1人のうち、ライバルの過半が他人の攻撃で倒れたゲーム */
  lastByCombat: number;
  jobGames: Partial<Record<JobId, number>>;
  jobWins: Partial<Record<JobId, number>>;
  traitGames: Partial<Record<TraitId, number>>;
  traitWins: Partial<Record<TraitId, number>>;
  totalTurns: number;
  finalPhaseGames: number;
  deathsByAttack: number;
  deathsOther: number;
  deathCauses: Record<string, number>;
  /** 新しいルールが起きた回数 */
  happenings: Record<string, number>;
  /** 職業ごとの到達度の合計（1で達成） */
  goalSum: Partial<Record<JobId, number>>;
  /** 空腹か渇きのターンに使ったAP／使ったAP全体 */
  survivalAp: number;
  spentAp: number;
  unusedAp: number;
  attacks: number;
  firstAttackTurnSum: number;
  firstAttackGames: number;
}

const add = <K extends string>(table: Partial<Record<K, number>>, key: K, by = 1) => {
  table[key] = (table[key] ?? 0) + by;
};

const LOW = 4;
const MAX_TURNS = 80;

function newReport(): SimReport {
  return {
    games: 0,
    unfinished: 0,
    reasons: {},
    lastByCombat: 0,
    jobGames: {},
    jobWins: {},
    traitGames: {},
    traitWins: {},
    totalTurns: 0,
    finalPhaseGames: 0,
    deathsByAttack: 0,
    deathsOther: 0,
    deathCauses: {},
    happenings: {},
    goalSum: {},
    survivalAp: 0,
    spentAp: 0,
    unusedAp: 0,
    attacks: 0,
    firstAttackTurnSum: 0,
    firstAttackGames: 0,
  };
}

function setUp(seed: string, players: number, size: MapSize): GameState {
  let draft = createDraft(seed, players, players);
  for (let i = 0; i < 40 && draft.phase !== 'done'; i++) draft = draftAuto(draft);
  return createGame(seed, players, { setups: finishDraft(draft), world: true, mapSize: size });
}

export function playOne(seed: string, players: number, size: MapSize, level: CpuLevel, report: SimReport) {
  let state = setUp(seed, players, size);
  let firstAttack: number | null = null;
  const lastHurt = new Map<number, string>();
  let turns = 0;
  while (!state.finished && turns < MAX_TURNS) {
    const plans: Record<number, PlanAction[]> = {};
    const before = new Map<number, number>();
    for (const player of state.players) {
      const view = getPlayerView(state, player.id);
      const rng = new Rng((state.rngState + player.id * 7919) | 0);
      plans[player.id] = player.alive ? planForCpu(view, level, rng) : ghostPlanForCpu(view, rng);
      before.set(player.id, player.ap);
      if (player.alive && plans[player.id].some((a) => a.type === 'attack')) {
        report.attacks += 1;
        firstAttack ??= state.turn;
      }
    }
    const hungry = new Set(state.players.filter((p) => p.alive && (p.hunger <= LOW || p.water <= LOW)).map((p) => p.id));
    const { state: next, steps } = resolveTurn(state, plans);
    // 手番の直前と直後のAPは解決の中で変わるので、行動の出来事から使った分を数える
    for (const step of steps) {
      for (const event of step.events) {
        if (['bountyPosted', 'escaped', 'survivorHeld', 'bountyClaimed', 'shipCalled', 'raftWorked'].includes(event.type)) {
          report.happenings[event.type] = (report.happenings[event.type] ?? 0) + 1;
        }
        if (event.type === 'crafted' && event.recipe === 'campfire') report.happenings.campfire = (report.happenings.campfire ?? 0) + 1;
        if (event.type === 'statusDamage') lastHurt.set(event.playerId, event.thirst > 0 ? 'thirst' : event.hunger > 0 ? 'hunger' : event.bleed > 0 ? 'bleed' : 'poison');
        if (event.type === 'weatherHit' && event.damage > 0) lastHurt.set(event.playerId, next.finalPhase ? 'finalStorm' : 'storm');
        if (event.type === 'npcHit') lastHurt.set(event.playerId, 'animal');
        if (event.type === 'gatherDanger') lastHurt.set(event.playerId, 'animal');
        if (event.type === 'drowned') lastHurt.set(event.playerId, 'drowned');
        if (event.type === 'trapTriggered') lastHurt.set(event.playerId, 'trap');
      }
      for (const event of step.events) {
        if (event.type !== 'moved') continue;
        report.spentAp += event.cost;
        if (hungry.has(event.playerId)) report.survivalAp += event.cost;
      }
      for (const event of step.events) {
        if (event.type === 'gathered' || event.type === 'gatherNothing' || event.type === 'gatherDanger' || event.type === 'drank') {
          report.spentAp += 1;
          if (hungry.has(event.playerId) || event.type === 'drank') report.survivalAp += 1;
        } else if (event.type === 'attackResult' || event.type === 'crafted' || event.type === 'healed' || event.type === 'hunted') {
          report.spentAp += 1;
        }
      }
    }
    state = next;
    turns += 1;
  }

  report.games += 1;
  report.totalTurns += turns;
  if (state.finalPhase) report.finalPhaseGames += 1;
  if (firstAttack !== null) {
    report.firstAttackTurnSum += firstAttack;
    report.firstAttackGames += 1;
  }
  if (!state.finished) report.unfinished += 1;
  let byAttack = 0;
  for (const player of state.players) {
    if (player.job) add(report.jobGames, player.job);
    if (player.secretTrait) add(report.traitGames, player.secretTrait);
    if (player.publicTrait) add(report.traitGames, player.publicTrait);
    if (!player.alive) {
      if (player.killerId !== null) {
        report.deathsByAttack += 1;
        byAttack += 1;
      } else {
        report.deathsOther += 1;
        const cause = lastHurt.get(player.id) ?? 'other';
        report.deathCauses[cause] = (report.deathCauses[cause] ?? 0) + 1;
      }
    }
  }
  for (const player of state.players) {
    if (player.job) add(report.goalSum, player.job, goalProgress(state, player));
  }
  const winner = state.winnerId === null ? null : state.players[state.winnerId];
  const reason = (state as { victoryReason?: VictoryReason | null }).victoryReason ?? null;
  add(report.reasons, winner ? (reason ?? 'lastStanding') : 'nobody');
  if (winner && (reason ?? 'lastStanding') === 'lastStanding' && byAttack * 2 >= state.players.length - 1) {
    report.lastByCombat += 1;
  }
  if (winner?.job) add(report.jobWins, winner.job);
  if (winner?.secretTrait) add(report.traitWins, winner.secretTrait);
  if (winner?.publicTrait) add(report.traitWins, winner.publicTrait);
}

function goalProgress(state: GameState, player: PlayerState): number {
  const p = player.progress;
  switch (player.job) {
    case 'fisher':
      return player.inventory.some((s) => s.item === 'island_lord') || p.lordCaughtBefore ? 1 : p.fishCaught / GOALS.lordCeiling;
    case 'carpenter':
      return Object.values(state.structures).some((s) => s.kind === 'fort' && s.ownerId === player.id) ? 1 : 0;
    case 'doctor':
      return Math.min(1, p.healCount / GOALS.healsNeeded);
    case 'soldier':
      return Math.min(1, p.warPoints / GOALS.warPoints);
    case 'explorer':
      return Math.min(1, p.explored.length / exploreTarget(state), p.specialsVisited.length / GOALS.specialsNeeded);
    case 'cook': {
      const held = new Set(player.inventory.map((s) => ITEM_GENRE[s.item]).filter(Boolean));
      return held.size / FOOD_GENRES.length;
    }
    default:
      return 0;
  }
}

export function simulate(options: SimOptions): SimReport {
  const report = newReport();
  for (let i = 0; i < options.games; i++) {
    const players = options.players[i % options.players.length];
    const size = options.sizes[Math.floor(i / options.players.length) % options.sizes.length];
    const level = options.levels[i % options.levels.length];
    playOne(`${options.seedPrefix}-${i}`, players, size, level, report);
  }
  return report;
}

const pct = (n: number, d: number) => (d === 0 ? '  -  ' : `${((n / d) * 100).toFixed(1).padStart(5)}%`);

export function formatReport(report: SimReport): string {
  const lines: string[] = [];
  const g = report.games;
  const special = Object.entries(report.reasons)
    .filter(([key]) => key !== 'lastStanding' && key !== 'nobody')
    .reduce((n, [, v]) => n + (v ?? 0), 0);
  const last = report.reasons.lastStanding ?? 0;
  lines.push(`games=${g} unfinished=${report.unfinished} avgTurns=${(report.totalTurns / g).toFixed(1)} finalPhase=${pct(report.finalPhaseGames, g)}`);
  lines.push(`特殊勝利 ${pct(special, g)} / 最後の1人 ${pct(last, g)}（うち攻撃中心 ${pct(report.lastByCombat, g)}） / 勝者なし ${pct(report.reasons.nobody ?? 0, g)}`);
  lines.push(`勝ち方: ${Object.entries(report.reasons).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => `${k} ${pct(v ?? 0, g).trim()}`).join(', ')}`);
  const deaths = report.deathsByAttack + report.deathsOther;
  lines.push(`脱落: 攻撃 ${pct(report.deathsByAttack, deaths)} / それ以外 ${pct(report.deathsOther, deaths)}　1ゲームの攻撃予約 ${(report.attacks / g).toFixed(1)}回　初攻撃 ターン${(report.firstAttackTurnSum / Math.max(1, report.firstAttackGames)).toFixed(1)}`);
  lines.push(`攻撃以外の脱落の内訳: ${Object.entries(report.deathCauses).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`1ゲームあたり: ${Object.entries(report.happenings ?? {}).map(([k, v]) => `${k} ${(v / g).toFixed(2)}`).join(', ')}`);
  lines.push(`生存に使ったAP: ${pct(report.survivalAp, report.spentAp)}`);
  const jobs = Object.keys(report.jobGames) as JobId[];
  lines.push(`職業の勝率: ${jobs.sort().map((job) => `${job} ${pct(report.jobWins[job] ?? 0, report.jobGames[job] ?? 0).trim()}`).join(', ')}`);
  lines.push(`目標の到達度: ${jobs.map((job) => `${job} ${pct(report.goalSum[job] ?? 0, report.jobGames[job] ?? 0).trim()}`).join(', ')}`);
  return lines.join('\n');
}
