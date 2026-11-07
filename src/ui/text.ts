// 出来事を文章にする。
import { ITEMS, TERRAIN, type GameEvent, type ItemStack, type PlanAction, type TerrainId } from '../core/index';

function stacksText(stacks: ItemStack[]): string {
  return stacks.map(({ item, count }) => (count > 1 ? `${ITEMS[item].name}×${count}` : ITEMS[item].name)).join('、');
}

export function describeEvent(event: GameEvent, nameOf: (id: number) => string, myId: number): string | null {
  switch (event.type) {
    case 'actorTurn':
      return event.playerId === myId ? 'あなたの手番' : `${nameOf(event.playerId)} の手番`;
    case 'moved':
      return `${TERRAIN[event.terrain].name}へ移動した（AP−${event.cost}）`;
    case 'blocked':
      if (event.reason === 'sea') return '海に阻まれて進めなかった';
      if (event.reason === 'protected') return 'まだ攻撃できない（3日目から）';
      if (event.reason === 'alreadyAttacked') return '攻撃は1ターンに1回まで';
      if (event.reason === 'noAp') {
        return event.terrain ? `${TERRAIN[event.terrain].name}へ進むにはAPが${event.cost}必要だった` : 'APが足りなかった';
      }
      return null;
    case 'planCancelled':
      return `残りの予約 ${event.count}件は実行できなかった`;
    case 'gathered': {
      const head = event.pity ? '粘った甲斐があった！ ' : '';
      const lost = event.lost.length > 0 ? `（${stacksText(event.lost)}は持ちきれず置いてきた）` : '';
      if (event.gained.length === 0) return `${head}${stacksText(event.lost)}を見つけたが、持ちきれない`;
      return `${head}${stacksText(event.gained)}を手に入れた${lost}`;
    }
    case 'gatherNothing':
      return event.missingTool ? '魚の影が見えたが、釣り道具がない' : '何も見つからなかった';
    case 'gatherDanger':
      return `野生動物に襲われた！ HP−${event.damage}`;
    case 'foundNest':
      return '小動物の巣を見つけた（次の狩りが有利）';
    case 'drank':
      return `${TERRAIN[event.terrain].name}の水を飲んだ（水筒があれば持ち運べる）`;
    case 'discarded':
      return `${ITEMS[event.item].name}を捨てた`;
    case 'attackResult': {
      const who = (id: number | null) => (id === null ? '誰か' : nameOf(id));
      if (event.attackerId === myId) {
        if (!event.hit) return `${who(event.targetId)}への攻撃は外れた`;
        const stolen = event.stolen ? `${stacksText([event.stolen])}を奪った。` : '';
        const counter = event.counter > 0 ? `反撃でHP−${event.counter}。` : '';
        return `${who(event.targetId)}に命中！ ${event.damage}ダメージ。${stolen}${counter}`;
      }
      if (!event.hit) return `${who(event.attackerId)}の攻撃をかわした`;
      const stolen = event.stolen ? `${stacksText([event.stolen])}を奪われた。` : '';
      const counter = event.counter > 0 ? `反撃で${event.counter}ダメージを与えた。` : '';
      return `${who(event.attackerId)}に攻撃された！ HP−${event.damage}。${stolen}${counter}`;
    }
    case 'attackFizzled':
      return '相手に届かず、攻撃は不発に終わった（AP−1）';
    case 'combatSeen':
      return `${event.attackerId === null ? '人影' : nameOf(event.attackerId)}が${event.targetId === null ? '誰か' : nameOf(event.targetId)}に襲いかかるのが見えた`;
    case 'relicTaken':
      return `遺品から${stacksText(event.items)}を拾った`;
    case 'sighted':
      return event.who === null ? '暗闇の中で人影が動いた' : `${nameOf(event.who)} の姿が見えた`;
    case 'playerEliminated':
      return event.playerId === myId ? 'あなたは力尽きた…' : `${nameOf(event.playerId)} が脱落した`;
    case 'gameFinished':
      return event.winnerId === null ? '誰も生き残らなかった' : `${nameOf(event.winnerId)} の勝ち！`;
    case 'turnStarted':
      return `―― ${event.day}日目の${event.phase === 'day' ? '昼' : '夜'} ――`;
  }
}

const DIRECTION_NAME = { up: '上', down: '下', left: '左', right: '右' } as const;

export function describePlanAction(action: PlanAction, terrain: TerrainId | null, nameOf: (id: number) => string): string {
  if (action.type === 'gather') return '採取';
  if (action.type === 'attack') return `${action.who === undefined ? '人影' : nameOf(action.who)}を攻撃`;
  if (action.type === 'discard') return `${ITEMS[action.item].name}を捨てる`;
  const where = terrain ? TERRAIN[terrain].name : '霧の中';
  return `${DIRECTION_NAME[action.direction]}へ（${where}）`;
}
