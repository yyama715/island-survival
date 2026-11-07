// 出来事を文章にする。
import {
  ITEMS,
  NPC_NAMES,
  RECIPES,
  TERRAIN,
  TRAITS,
  type GameEvent,
  type HauntKind,
  type ItemStack,
  type PlanAction,
  type TerrainId,
  type VictoryReason,
  type Weather,
} from '../core/index';

export const WEATHER_NAMES: Record<Weather, string> = { sunny: '晴れ', rain: '雨', storm: '嵐' };
export const HAUNT_NAMES: Record<HauntKind, string> = { fog: '濃霧', noise: '物音', lure: '動物を誘う', bless: '守護' };
export const HAUNT_NOTES: Record<HauntKind, string> = {
  fog: '周りのマスの視界を狭める',
  noise: 'このマスに偽の足跡を残す',
  lure: '近くの動物をこのマスへ1歩進める',
  bless: 'このマスの採取率を上げる',
};

export const VICTORY_TEXT: Record<VictoryReason, string> = {
  lastStanding: '最後の1人として生き残った',
  fisher: '島の主を釣り上げて守り抜いた',
  carpenter: '砦を守り抜いた',
  doctor: '人々を治療し、7日目の朝を迎えた',
  soldier: '戦果を挙げた',
  explorer: '島を踏破した',
  cook: '島のフルコースを完成させた',
  raft: 'いかだで島を脱出した',
  ship: '救助船に乗った',
};

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
    case 'healed':
      if (event.targetId === null) return '治療する相手がいなかった';
      return `${nameOf(event.targetId)}を治療した（HP+${event.hp}${event.maxHpUp ? '、最大HP+1' : ''}）`;
    case 'wasHealed':
      return `治療してもらった（HP+${event.hp}${event.maxHpUp ? '、最大HP+1' : ''}）`;
    case 'explored':
      return '周りを探索した（このターンは視界+1）';
    case 'repaired':
      return `砦を修理した（耐久${event.hp}）`;
    case 'smashed':
      return event.destroyed
        ? `${event.kind === 'fort' ? '砦' : 'いかだ'}を壊した`
        : `${event.kind === 'fort' ? '砦' : 'いかだ'}を攻撃した（耐久${event.hp}）`;
    case 'raftWorked':
      return event.complete
        ? 'いかだが完成した！'
        : `いかだに素材を運んだ（${stacksText(event.stored) || 'なし'}）`;
    case 'radioFixed':
      return '無線機を直した。これで救助を呼べる';
    case 'scouted':
      return '遠くの様子を見た';
    case 'shipCalled':
      return `救助船を呼んだ。ターン${event.arrivesTurn}に到着する（地図に船の目印）`;
    case 'traitRevealed':
      return `${nameOf(event.playerId)}の秘密特性「${TRAITS[event.trait].name}」が発動した！`;
    case 'nearVictory':
      return '誰かが勝利目前だ！';
    case 'lordCaught':
      return '島の主が釣り上げられた！';
    case 'fortCompleted':
      return '砦が完成した！';
    case 'fortDestroyed':
      return '砦が壊された！';
    case 'smokeLit':
      return '狼煙が上がった！ 救助船が来る';
    case 'smokeOut':
      return '狼煙が消された';
    case 'shipSoon':
      return '救助船が見えた！ 次のターンに到着する（地図に目印）';
    case 'shipArrived':
      return '救助船が着いた！ 最初に入った人が乗れる';
    case 'shipLeft':
      return '救助船は去っていった';
    case 'playerRevived':
      return `${nameOf(event.playerId)}が執念で戻ってきた！`;
    case 'victory':
      return `${nameOf(event.playerId)}が${VICTORY_TEXT[event.reason]}！`;
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
    case 'weatherChanged':
      return `今日の天気は${WEATHER_NAMES[event.weather]}`;
    case 'supplyDropped':
      return '空から支援物資が落ちてきた！（地図に目印）';
    case 'quake':
      return '地震だ！ 島のどこかの地形が変わったらしい';
    case 'herdAppeared':
      return '動物の群れが島を駆け抜けていく！';
    case 'boarAppeared':
      return '大イノシシが島に現れた！';
    case 'castawayAppeared':
      return '浜辺に誰かが打ち上げられた';
    case 'tideNotice':
      return '潮が満ちてきた。明日、砂浜が沈む（地図に目印）';
    case 'tideRose':
      return '砂浜が海に沈んだ';
    case 'finalStarted':
      return '最終局面！ 島が外側から沈み始めた。もう特殊勝利はできない';
    case 'finalSunk':
      return `島の外側が${event.cells}マス沈んだ`;
    case 'weatherHit':
      if (event.damage > 0) return `激しい風雨に打たれてHP−${event.damage}`;
      if (event.water > 0) return `雨水を飲んだ（水分+${event.water}）`;
      if (event.water < 0) return `暑さで水分${event.water}`;
      return null;
    case 'npcHit':
      return `${NPC_NAMES[event.kind]}に襲われた！ HP−${event.damage}`;
    case 'monkeyStole':
      return `猿に${ITEMS[event.item].name}を盗まれた！`;
    case 'hunted': {
      if (!event.hit) return `${NPC_NAMES[event.kind]}を狙ったが、外れた`;
      if (!event.killed) return `${NPC_NAMES[event.kind]}に当たった！ まだ倒れない`;
      const lost = event.lost.length > 0 ? `（${stacksText(event.lost)}は持ちきれず置いてきた）` : '';
      return `${NPC_NAMES[event.kind]}を仕留めた！ ${stacksText(event.gained)}${lost}`;
    }
    case 'aided': {
      const lost = event.lost.length > 0 ? `（${stacksText(event.lost)}は持ちきれず置いてきた）` : '';
      return `漂流者を手当てした。お礼に${stacksText(event.gained) || '感謝の言葉'}をもらい、一緒に来てくれる${lost}`;
    }
    case 'drowned':
      return event.playerId === myId ? '波にのまれた…' : `${nameOf(event.playerId)}が波にのまれた`;
    case 'haunted':
      return `幽霊の力：${HAUNT_NAMES[event.kind]}`;
    case 'cursed':
      return '自分を倒した相手に祟りをかけた';
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
  if (action.type === 'heal') return `${target(action.who)}を治療`;
  if (action.type === 'explore') return '探索';
  if (action.type === 'repair') return '砦を修理';
  if (action.type === 'smash') return '建物を壊す';
  if (action.type === 'extinguish') return '狼煙を消す';
  if (action.type === 'raftWork') return 'いかだに素材を運ぶ';
  if (action.type === 'launch') return 'いかだで脱出';
  if (action.type === 'useRadio') return '無線機を使う';
  if (action.type === 'scout') return '遠くを見る（鷹の目）';
  if (action.type === 'falseAlarm') return '偽の知らせを出す';
  if (action.type === 'discard') return `${ITEMS[action.item].name}を捨てる`;
  if (action.type === 'hunt') return '動物を狩る';
  if (action.type === 'aid') return '漂流者を手当てする';
  if (action.type === 'haunt') return `怪異：${HAUNT_NAMES[action.kind]}`;
  if (action.type === 'curse') return '祟りをかける';
  const where = terrain ? TERRAIN[terrain].name : '霧の中';
  return `${DIRECTION_NAME[action.direction]}へ（${where}）`;
}
