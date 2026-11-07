// 出来事を文章にする。
import { ITEMS, RECIPES, TERRAIN, type GameEvent, type ItemStack, type PlanAction, type TerrainId } from '../core/index';

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
      if (event.reason === 'missingMaterials') return '素材が足りず、作れなかった';
      if (event.reason === 'occupied') return 'ここにはもう建物があって建てられない';
      if (event.reason === 'cannotHide') return 'ここには隠れられない（森と岩場だけ）';
      if (event.reason === 'notOwned') return '持っていなかった';
      if (event.reason === 'inventoryFull') return '持ち物がいっぱいで作れなかった';
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
        const head = event.ambush ? '待ち伏せ！ ' : '';
        const broke = event.bottleBroke ? '瓶は割れた。' : '';
        if (!event.hit) return `${head}${who(event.targetId)}への攻撃は外れた。${broke}`;
        const bled = event.bleeding ? '相手は出血した。' : '';
        const stolen = event.stolen ? `${stacksText([event.stolen])}を奪った。` : '';
        const counter = event.counter > 0 ? `反撃でHP−${event.counter}。` : '';
        return `${head}${who(event.targetId)}に命中！ ${event.damage}ダメージ。${broke}${bled}${stolen}${counter}`;
      }
      const head = event.ambush ? '待ち伏せされていた！ ' : '';
      if (!event.hit) return `${head}${who(event.attackerId)}の攻撃をかわした`;
      const stolen = event.stolen ? `${stacksText([event.stolen])}を奪われた。` : '';
      const counter = event.counter > 0 ? `反撃で${event.counter}ダメージを与えた。` : '';
      const bled = event.bleeding ? '出血した！ 包帯で止められる。' : '';
      return `${head}${who(event.attackerId)}に攻撃された！ HP−${event.damage}。${bled}${stolen}${counter}`;
    }
    case 'used': {
      const name = ITEMS[event.item].name;
      const gains = [
        event.hunger > 0 ? `満腹度+${event.hunger}` : '',
        event.water > 0 ? `水分+${event.water}` : '',
        event.hp > 0 ? `HP+${event.hp}` : '',
      ].filter(Boolean).join('、');
      const poisoned = event.poisoned ? ' お腹が痛い…食中毒だ！' : '';
      const stopped = event.stoppedBleeding ? ' 血が止まった。' : '';
      return `${name}を使った（${gains || '変化なし'}）${poisoned}${stopped}`;
    }
    case 'statusDamage': {
      const causes = [
        event.hunger > 0 ? `空腹でHP−${event.hunger}` : '',
        event.thirst > 0 ? `渇きでHP−${event.thirst}` : '',
        event.poison > 0 ? `中毒でHP−${event.poison}` : '',
        event.bleed > 0 ? `出血でHP−${event.bleed}` : '',
      ].filter(Boolean);
      return causes.join('、');
    }
    case 'bleedStopped':
      return '血が自然に止まった';
    case 'fatigued':
      return '疲れが出てきた（次のターンはAP−1）';
    case 'rested':
      return `休息した（HP+${event.healed}）`;
    case 'crafted': {
      const recipe = RECIPES[event.recipe];
      if (recipe.builds) return `${recipe.name}を作った`;
      const lost = event.lost.length > 0 ? '（持ちきれず置いてきた）' : '';
      return `${recipe.name}を作った${lost}`;
    }
    case 'guarded':
      return '周りを警戒した';
    case 'hid':
      return '身を隠した';
    case 'ambushSet':
      return 'このマスで待ち伏せしている';
    case 'foundOut':
      return '隠れていたのを見つかった！';
    case 'spotted':
      return '隠れている人を見つけた！';
    case 'trapTriggered':
      return `罠にかかった！ HP−${event.damage}。足止めされて動けない`;
    case 'trapDisarmed':
      return '罠を見つけて外した';
    case 'trapSprung':
      return '置いた罠が作動した';
    case 'letterLeft':
      return '手紙を置いた';
    case 'whisperAsked':
      return '密談を持ちかけた';
    case 'whisperFailed':
      return '相手が離れてしまい、密談できなかった';
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
  const target = (who?: number) => (who === undefined ? '人影' : nameOf(who));
  if (action.type === 'attack') {
    const how = action.throwStone ? 'に石を投げる' : action.useBottle ? 'を瓶で殴る' : 'を攻撃';
    return `${target(action.who)}${how}`;
  }
  if (action.type === 'whisper') return `${target(action.who)}に密談を持ちかける`;
  if (action.type === 'use') return `${ITEMS[action.item].name}を使う`;
  if (action.type === 'craft') return `${RECIPES[action.recipe].name}を作る`;
  if (action.type === 'rest') return '残りのAPで休息';
  if (action.type === 'guard') return '防御・警戒';
  if (action.type === 'hide') return '隠れる';
  if (action.type === 'ambush') return 'このマスで待ち伏せ';
  if (action.type === 'letter') return '手紙を置く';
  if (action.type === 'discard') return `${ITEMS[action.item].name}を捨てる`;
  const where = terrain ? TERRAIN[terrain].name : '霧の中';
  return `${DIRECTION_NAME[action.direction]}へ（${where}）`;
}
