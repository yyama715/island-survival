// 画面。サーバーから届いた見え方だけで描く。ルールの判定はサーバーが行い、画面は見込みの計算だけをする。
import '@fontsource/dotgothic16';
import {
  AID_AP,
  AMBUSH_AP,
  ATTACK_AP,
  CPU_LEVEL_NAMES,
  BALANCE,
  BOTTLE_ITEM,
  EXPLORE_AP,
  GATHER_AP,
  GUARD_AP,
  HEAL_AP,
  HEAL_RANGE,
  HIDE_AP,
  HUNT_AP,
  isProtected,
  ITEMS,
  JOB_IDS,
  JOBS,
  LETTER,
  MAP_SIZE_NAMES,
  NPC_NAMES,
  projectPlan,
  RARITY_NAMES,
  recipeAp,
  RECIPES,
  STACK_SIZE,
  TRAIT_USE_NAMES,
  TRAITS,
  type DraftView,
  type JobId,
  type TraitId,
  TERRAIN,
  THROW_ITEM,
  WEAK_THRESHOLD,
  WHISPER,
  WHISPER_AP,
  type CellView,
  type CpuLevel,
  type GameEvent,
  type Direction,
  type HauntKind,
  type ItemId,
  type MapSize,
  type PlanAction,
  type PlayerView,
  type RecipeId,
  type ReplayStep,
  type TerrainId,
} from '../core/index';
import type { PlanStatus, ServerMessage } from '../net/protocol';
import { sound, type SeId } from './audio';
import { Net } from './net';
import {
  arrowUrl,
  bubbleUrl,
  fogUrl,
  footprintUrl,
  ghostUrl,
  iconUrl,
  itemUrl,
  markUrl,
  npcUrl,
  personUrl,
  rainUrl,
  relicUrl,
  shadowUrl,
  shoreUrl,
  spriteImg,
  structureUrl,
  terrainUrl,
  waveUrl,
  weatherIcon,
} from './sprites';
import { describeEvent, describePlanAction, HAUNT_NAMES, HAUNT_NOTES, VICTORY_TEXT, WEATHER_NAMES } from './text';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STRUCTURE_NAMES = { hut: '小屋', trap: '自分の罠', fort: '砦', smoke: '狼煙', raft: 'いかだ', campfire: '焚き火' } as const;
const STRUCTURE_NOTES = {
  hut: '小屋がある（休息の回復が倍）',
  trap: '自分の置いた罠がある',
  fort: '砦がある（中にいると防御+2）',
  smoke: '狼煙が上がっている',
  raft: 'いかだがある',
  campfire: '焚き火がある（ここで食べると回復+1、夜は周りが明るい）',
} as const;

const MARK_NOTES = {
  smoke: '狼煙が上がっている',
  ship: '救助船が来ている！ 最初に入った人が乗れる',
  shipComing: '救助船がここへ向かっている',
  sink: 'このマスは次に沈む！',
  supply: '支援物資が落ちている。採取で拾える',
  bounty: '賞金首！ 勝利目前の人がこの周り3×3のどこかにいる',
  campfire: '焚き火の煙が見える',
} as const;

const KEY_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
};

const DELTA: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const URGENT_SECONDS = 10;
const SLOW_CONNECT_MS = 15_000;
const ERROR_TOAST_MS = 6000;
const TOAST_MS = 2600;

type Screen = 'home' | 'lobby' | 'draft' | 'game' | 'result';

let draftDeadline = 0;
/** 所持品の選択中 */
let draftItemPicks = new Set<number>();

// 画面の状態
let view: PlayerView | null = null;
let plan: PlanAction[] = [];
let ready = false;
let planning = false;
let status: PlanStatus[] = [];
let deadline = 0;
let inspected: { x: number; y: number } | null = null;
let log: string[] = [];
let cellButtons: HTMLButtonElement[] = [];
const cellHtml = new WeakMap<HTMLButtonElement, string>();
let builtSize = 0;
let replayTimer: ReturnType<typeof setTimeout> | null = null;
let actingId: number | null = null;
let hostCanStart = false;
let inviteUrl = '';
/** URLで招待されている合言葉。別のルームの席が残っていても、こちらを優先する */
let invitedCode = new URLSearchParams(location.search).get('room')?.trim().toUpperCase() ?? '';
let switchingRoom = false;
/** 書きかけの密談。画面を描き直しても消えないように持っておく */
const whisperDrafts = new Map<number, string>();

const net = new Net({
  onMessage: handleMessage,
  onConnectionChange(connected) {
    const banner = $('connection-banner');
    banner.hidden = connected;
    if (connected) window.clearTimeout(slowConnectTimer);
    else {
      banner.textContent = '接続が切れました。再接続しています…';
      watchSlowConnect();
    }
  },
  onReadyWithoutRoom() {
    showInviteOnHome();
    showScreen('home');
  },
});

let currentScreen: Screen = 'home';
let headphoneHintShown = false;

function showScreen(screen: Screen) {
  currentScreen = screen;
  if (screen === 'lobby') sound.drums = false;
  if (screen === 'game' && !headphoneHintShown) {
    headphoneHintShown = true;
    toast('ヘッドホンでの参加がおすすめです（自分だけの音がボイスチャットに入らないように）', ERROR_TOAST_MS);
  }
  updateMusic();
  $('screen-home').hidden = screen !== 'home';
  $('screen-lobby').hidden = screen !== 'lobby';
  $('screen-draft').hidden = screen !== 'draft';
  $('screen-game').hidden = screen !== 'game';
  $('screen-result').hidden = screen !== 'result';
}

/** 席の人物の絵。職業が決まれば帽子が変わる */
function seatSprite(id: number, job: JobId | null = null): HTMLImageElement {
  return spriteImg(personUrl(job, id), 'sprite sprite-person');
}

/** 10.4 BGM は公開情報（画面、昼夜、天候、最終局面）だけで決め、本人の状態は重ねる音で伝える */
function updateMusic() {
  if (currentScreen === 'home' || currentScreen === 'lobby') sound.play('title');
  else if (currentScreen === 'draft') sound.play('draft');
  else if (currentScreen === 'result') sound.play('result');
  else if (view) {
    const finalTurns = Math.max(0, view.turn - 21);
    if (!view.me.alive && view.ghost) sound.play('ghost');
    else if (view.finalPhase) sound.play('final', finalTurns * 4);
    else if (view.worldActive && view.weather === 'storm') sound.play('storm');
    else if (view.phase === 'night') sound.play('night');
    else sound.play('day', view.day >= 7 ? 12 : 0);
  }
  sound.heartbeat = currentScreen === 'game' && !!view?.me.alive && view.me.hp <= 3;
}

/** 出来事の音。相手の位置が分かる音は左右に振る */
function eventSound(event: GameEvent, current: PlayerView): [SeId, number] | null {
  const myId = current.me.id;
  const panAt = (x: number) => Math.max(-1, Math.min(1, (x - current.me.x) / 4));
  switch (event.type) {
    case 'gathered':
      return [event.pity ? 'gatherRare' : 'gather', 0];
    case 'gatherNothing':
      return ['gatherNone', 0];
    case 'gatherDanger':
    case 'npcHit':
      return ['hurt', 0];
    case 'foundNest':
    case 'healed':
    case 'wasHealed':
    case 'radioFixed':
    case 'shipCalled':
      return ['progress', 0];
    case 'attackResult':
      if (event.targetId === myId && event.attackerId !== myId) return [event.hit ? 'hurt' : 'miss', 0];
      return [event.hit ? 'hit' : 'miss', event.attackerId === myId ? 0 : panAt(event.x)];
    case 'hunted':
      return [event.hit ? 'hit' : 'miss', 0];
    case 'combatSeen':
      return ['hit', panAt(event.x)];
    case 'trapTriggered':
    case 'trapSprung':
      return ['trap', 0];
    case 'statusDamage':
      return ['warn', 0];
    case 'traitRevealed':
      return ['trait', 0];
    case 'allianceBroken':
    case 'betrayalSensed':
      return ['warn', 0];
    case 'allianceFormed':
    case 'traded':
      return ['progress', 0];
    case 'escaped':
      return ['step', 0];
    case 'bountyPosted':
    case 'bountyClaimed':
      return ['nearVictory', 0];
    case 'nearVictory':
      sound.drums = true;
      return ['nearVictory', 0];
    case 'playerEliminated':
      return ['bell', 0];
    case 'smokeLit':
      return ['smoke', 0];
    case 'shipSoon':
    case 'shipArrived':
      return ['horn', 0];
    case 'lordCaught':
      return ['lord', 0];
    case 'fortCompleted':
      return ['fort', 0];
    case 'weatherChanged':
    case 'supplyDropped':
      return ['weather', 0];
    case 'tideNotice':
    case 'tideRose':
    case 'finalSunk':
    case 'finalStarted':
    case 'quake':
      return ['tide', 0];
    case 'playerRevived':
      return ['revive', 0];
    case 'sighted':
      return ['step', 0];
    case 'herdAppeared':
    case 'boarAppeared':
      return ['animal', 0];
    case 'monkeyStole':
      return ['monkey', 0];
    case 'haunted':
      return ['haunt', 0];
    case 'crafted':
    case 'raftWorked':
    case 'repaired':
      return ['craft', 0];
    case 'used':
      return ['eat', 0];
    case 'victory':
    case 'gameFinished':
      return ['victory', 0];
    default:
      return null;
  }
}

function playEvents(events: GameEvent[]) {
  if (!view) return;
  const played = new Set<SeId>();
  for (const event of events) {
    const found = eventSound(event, view);
    if (!found || played.has(found[0])) continue;
    played.add(found[0]);
    sound.se(found[0], found[1]);
  }
}

/** 音量の設定。ホームとゲーム画面の両方に同じものを出す */
function renderSoundControls() {
  for (const id of ['sound-home', 'sound-game']) {
    const box = $(id);
    const mute = document.createElement('label');
    mute.className = 'sound-row';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = !sound.settings.muted;
    check.addEventListener('change', () => {
      sound.unlock();
      sound.setMuted(!check.checked);
      renderSoundControls();
    });
    const label = document.createElement('span');
    label.textContent = '音を出す';
    mute.append(check, label);
    const slider = (name: string, kind: 'bgm' | 'se') => {
      const row = document.createElement('label');
      row.className = 'sound-row';
      const text = document.createElement('span');
      text.textContent = name;
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0';
      range.max = '1';
      range.step = '0.05';
      range.value = String(sound.settings[kind]);
      range.setAttribute('aria-label', `${name}の音量`);
      range.addEventListener('change', () => {
        sound.unlock();
        sound.setVolume(kind, Number(range.value));
        if (kind === 'se') sound.se('gather');
        renderSoundControls();
      });
      row.append(text, range);
      return row;
    };
    box.replaceChildren(mute, slider('BGM', 'bgm'), slider('効果音', 'se'));
  }
}

function toast(text: string, ms = TOAST_MS) {
  const element = $('toast');
  element.textContent = text;
  element.hidden = false;
  window.clearTimeout(Number(element.dataset.timer));
  element.dataset.timer = String(window.setTimeout(() => (element.hidden = true), ms));
}

let slowConnectTimer = 0;

/** サーバーの目覚めを待つ間も、接続できない場合も、何が起きているかを見せる */
function watchSlowConnect() {
  window.clearTimeout(slowConnectTimer);
  slowConnectTimer = window.setTimeout(() => {
    $('connection-banner').textContent =
      'まだ接続できません。サーバーの起動に1分ほどかかることがあります。続くときは Wi-Fi とモバイル回線を切り替えてください。';
  }, SLOW_CONNECT_MS);
}

/** 今いる席とURLをそろえる。再読み込みしたときに、別のルームへの招待と間違えないように */
function setRoomInUrl(code: string | null) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}

function showInviteOnHome() {
  $<HTMLInputElement>('join-code').value = invitedCode;
  $('invite-hint').hidden = !invitedCode;
  $('join-error').hidden = true;
}

function handleMessage(message: ServerMessage) {
  switch (message.t) {
    case 'joined':
      net.resuming = false;
      if (invitedCode && message.code !== invitedCode) {
        // 前のルームの席が残っている。招待を優先して抜ける
        switchingRoom = true;
        net.send({ t: 'leave' });
        break;
      }
      invitedCode = '';
      setRoomInUrl(message.code);
      break;
    case 'lobby':
      if (switchingRoom) break;
      stopReplay();
      view = null;
      log = [];
      renderLobby(message);
      showScreen('lobby');
      break;
    case 'planning':
      if (switchingRoom) break;
      stopReplay();
      view = message.view;
      plan = message.plan;
      ready = message.ready;
      status = message.status;
      planning = true;
      deadline = Date.now() + message.remainingMs;
      inspected = null;
      showScreen('game');
      ensureMap(view);
      render(true);
      break;
    case 'status':
      status = message.status;
      if (view) renderOrder();
      break;
    case 'draft':
      if (switchingRoom) break;
      draftDeadline = Date.now() + message.remainingMs;
      renderDraft(message.view, message.names);
      showScreen('draft');
      break;
    case 'announce':
      if (view) {
        playEvents(message.events);
        for (const event of message.events) {
          const text = describeEvent(event, nameOf, view.me.id);
          if (text) log.unshift(text);
        }
        render(false);
      }
      break;
    case 'mindReadResult': {
      const lines = message.actions.map((a) => describePlanAction(a, null, nameOf)).join('、') || '何も予約していない';
      log.unshift(`読心術：${nameOf(message.targetId)}の今の予約は「${lines}」`);
      toast(`${nameOf(message.targetId)}の予約：${lines}`, ERROR_TOAST_MS);
      if (view) render(false);
      break;
    }
    case 'whisperUpdate':
      if (view) {
        const before = new Set(view.whispers.map((w) => w.id));
        if (message.whispers.some((w) => w.incoming && w.status === 'pending' && !before.has(w.id))) sound.se('whisper');
        view.whispers = message.whispers;
        view.whisperSeen = message.whisperSeen;
        renderWhispers(view);
        view.cells.forEach((cell, i) => renderCell(cellButtons[i], cell, view!));
      }
      break;
    case 'waiting':
      if (switchingRoom) break;
      stopReplay();
      view = message.view;
      status = message.status;
      planning = false;
      plan = [];
      showScreen('game');
      ensureMap(view);
      render(true);
      break;
    case 'replay':
      planning = false;
      ready = false;
      plan = [];
      inspected = null;
      playReplay(message.steps, message.stepMs);
      break;
    case 'result':
      if (switchingRoom) break;
      stopReplay();
      $('result-title').textContent =
        message.winnerName === null ? '誰も生き残らなかった' : `${message.winnerName} の勝ち！`;
      $('result-reason').textContent = message.reason ? VICTORY_TEXT[message.reason] : '';
      {
        const winner = message.players.find((p) => p.id === message.winnerId);
        const art = $<HTMLImageElement>('result-winner');
        art.hidden = !winner;
        if (winner) art.src = personUrl(winner.job, winner.id);
      }
      // 10.1 リザルトでは全員の秘密特性と進み具合を公開する
      $('result-players').replaceChildren(
        ...message.players.map((player) => {
          const box = document.createElement('div');
          box.className = 'result-player';
          const head = document.createElement('div');
          head.className = 'result-head';
          const name = document.createElement('b');
          name.textContent = `${player.name}${player.id === message.winnerId ? '（勝者）' : ''}`;
          head.append(seatSprite(player.id, player.job), name);
          if (player.cpu) {
            const cpu = document.createElement('span');
            cpu.className = 'tag tag-cpu';
            cpu.textContent = 'CPU';
            head.append(cpu);
          }
          box.append(head);
          const job = [player.job, player.extraJob].filter(Boolean).map((id) => JOBS[id as JobId].name).join(' + ');
          const traits = [player.publicTrait, player.secretTrait].filter(Boolean).map((id) => TRAITS[id as TraitId].name).join('、');
          const detail = document.createElement('p');
          detail.className = 'muted';
          detail.textContent = `${job || '職業なし'}／${traits || '特性なし'}`;
          box.append(detail);
          for (const goal of player.goals) {
            const line = document.createElement('p');
            line.className = 'goal-line';
            line.textContent = `${goal.label}：${goal.value}`;
            box.append(line);
          }
          return box;
        }),
      );
      $('result-seed').textContent = message.seed;
      $('back-to-lobby').hidden = !message.youAreHost;
      $('result-wait').hidden = message.youAreHost;
      showScreen('result');
      break;
    case 'left':
      net.clearToken();
      stopReplay();
      view = null;
      if (!switchingRoom) setRoomInUrl(null);
      switchingRoom = false;
      showInviteOnHome();
      showScreen('home');
      break;
    case 'error': {
      const wasResuming = net.resuming;
      net.resuming = false;
      if (wasResuming) {
        // 保存していた席が消えていた。招待されているなら、そちらへの案内だけを出す
        net.clearToken();
        showInviteOnHome();
        showScreen('home');
        if (invitedCode) break;
      }
      if (!$('screen-home').hidden) {
        const error = $('join-error');
        error.textContent = message.message;
        error.hidden = false;
        $('invite-hint').hidden = true;
      } else {
        toast(message.message, ERROR_TOAST_MS);
      }
      break;
    }
  }
}

// ―― ロビー ――

function renderLobby(message: Extract<ServerMessage, { t: 'lobby' }>) {
  // 公開先では自分が開いているアドレスをそのまま渡す。localhost は友だちから見えないのでサーバーの案内を使う
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  inviteUrl = isLocal ? message.inviteUrl : `${location.origin}/?room=${message.code}`;
  // 手元のサーバーで作ったルームは、公開サイトとは別物で、外からは入れない
  $('local-warning').hidden = !(isLocal || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname));
  hostCanStart = message.youId === message.hostId;
  $('lobby-code').textContent = message.code;
  $('invite-url').textContent = inviteUrl;
  $('lobby-count').textContent = `${message.members.length} / ${message.setup.players}人`;
  $('lobby-members').replaceChildren(
    ...message.members.map((member) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = member.name;
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = [
        member.id === message.youId ? 'あなた' : '',
        member.id === message.hostId ? '作成者' : '',
        member.connected ? '' : '切断中',
      ]
        .filter(Boolean)
        .join('・');
      row.append(seatSprite(member.id), name, note);
      return row;
    }),
  );
  const seed = message.setup.seed ? `・シード値 ${message.setup.seed}` : '';
  const cpu = message.setup.cpuLevel ? `・空席はCPU（${CPU_LEVEL_NAMES[message.setup.cpuLevel]}）` : '';
  $('lobby-rules').textContent = `広さ「${MAP_SIZE_NAMES[message.setup.mapSize]}」・ターンの長さ ${message.setup.planSeconds}秒${cpu}${seed}`;
  $('start-game').hidden = !hostCanStart;
  $('lobby-wait').hidden = hostCanStart;
}

// ―― キャラ選択 ――

/** 特性の使い方。回数、自動かボタンか、秘密特性なら明かされるか */
function traitUsage(id: TraitId): string {
  const def = TRAITS[id];
  const parts = [TRAIT_USE_NAMES[def.uses], def.action ? `自分で使う：${def.action}` : '自動で効く'];
  if (def.secret) parts.push(def.reveals ? '効くと全員に明かされる' : '明かされない');
  return parts.join('／');
}

/** 今使えるかどうか。1回だけ・1日1回の特性にだけ出す */
function traitState(id: TraitId, current: PlayerView | null): string {
  if (!current) return '';
  const def = TRAITS[id];
  if (def.uses === 'once' && def.secret) return current.secret.used ? '使用済み' : 'まだ使える';
  if (id === 'respected') return current.freeWhisperSpent ? '今日は使用済み' : '今日はまだ使える';
  if (id === 'hawk_eye') return current.scoutSpent ? '今日は使用済み' : '今日はまだ使える';
  return '';
}

function traitLine(label: string, id: TraitId, current: PlayerView | null = null): HTMLElement {
  const def = TRAITS[id];
  const line = document.createElement('p');
  line.className = 'trait-line';
  const name = document.createElement('b');
  name.textContent = `${label}：${def.name}（${RARITY_NAMES[def.rarity]}）`;
  line.append(name, document.createTextNode(` ${def.text}`));
  const usage = document.createElement('span');
  usage.className = 'trait-usage';
  usage.textContent = traitUsage(id);
  line.append(usage);
  const state = traitState(id, current);
  if (state) {
    const tag = document.createElement('span');
    tag.className = `tag ${state.includes('使用済み') ? 'tag-off' : 'tag-ready'}`;
    tag.textContent = state;
    line.append(' ', tag);
  }
  return line;
}

function choice(title: string, detail: string, label: string, onClick: (() => void) | null, picked = false, art?: HTMLImageElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'choice';
  if (art) row.append(art);
  const info = document.createElement('div');
  info.className = 'choice-info';
  const name = document.createElement('b');
  name.textContent = title;
  const text = document.createElement('span');
  text.className = 'muted';
  text.textContent = detail;
  info.append(name, text);
  row.append(info);
  if (onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn-small${picked ? ' picked' : ''}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    row.append(button);
  }
  return row;
}

function draftNote(text: string): HTMLElement {
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = text;
  return note;
}

function renderDraft(current: DraftView, names: string[]) {
  const mine = $('draft-mine');
  const heading = document.createElement('h2');
  heading.textContent = 'あなたの固有能力';
  mine.replaceChildren(heading, traitLine('公開特性', current.publicTrait), traitLine('秘密特性', current.secretTrait));
  if (current.bonusItem) {
    const bonus = document.createElement('p');
    bonus.className = 'trait-line';
    bonus.textContent = `秘密の追加所持品：${ITEMS[current.bonusItem.item].name}×${current.bonusItem.count}（秘密特性がコモンの補償）`;
    mine.append(bonus);
  }
  if (current.extraJob) {
    const extra = document.createElement('p');
    extra.className = 'trait-line';
    extra.textContent = `秘密の職業：${JOBS[current.extraJob].name}。${JOBS[current.extraJob].goal}`;
    mine.append(extra);
  }

  const seatName = (id: number) => names[id] ?? `P${id + 1}`;
  const body = $('draft-body');
  const items: HTMLElement[] = [];

  if (current.phase === 'reroll') {
    items.push(draftNote('公開特性を1回だけ引き直せます。引き直すと初期所持品が1つ減ります。'));
    if (current.rerollDone) items.push(draftNote('他の人を待っています…'));
    else {
      items.push(
        choice('このまま進む', '', '決定', () => net.send({ t: 'draftReroll', reroll: false })),
        choice('引き直す', '初期所持品−1', '引き直す', () => net.send({ t: 'draftReroll', reroll: true })),
      );
    }
  } else if (current.phase === 'job') {
    const myTurn = current.turnSeat === current.you;
    items.push(draftNote(myTurn ? '職業を選んでください。' : `${seatName(current.turnSeat ?? 0)}が職業を選んでいます…`));
    for (const id of JOB_IDS) {
      const def = JOBS[id];
      const taken = current.seats.find((s) => s.job === id);
      items.push(
        choice(
          `${def.name}${taken ? `（${seatName(taken.id)}）` : ''}`,
          `機敏さ${def.agility}。${def.passive}。勝利条件：${def.goal}`,
          '選ぶ',
          myTurn && !taken ? () => net.send({ t: 'draftJob', job: id }) : null,
          false,
          seatSprite(current.you, id),
        ),
      );
    }
  } else if (current.phase === 'items') {
    const job = current.seats[current.you].job;
    if (current.itemsDone || !job) {
      items.push(draftNote('他の人を待っています…'));
    } else {
      items.push(draftNote(`初期所持品を${current.allowance}つ選んでください。${current.rerolled ? '（引き直したので1つ少なくなっています）' : ''}`));
      JOBS[job].items.forEach((stack, index) => {
        items.push(
          choice(`${ITEMS[stack.item].name}×${stack.count}`, '', draftItemPicks.has(index) ? '選択中' : '選ぶ', () => {
            if (draftItemPicks.has(index)) draftItemPicks.delete(index);
            else if (draftItemPicks.size < current.allowance) draftItemPicks.add(index);
            renderDraft(current, names);
          }, draftItemPicks.has(index), spriteImg(itemUrl(stack.item))),
        );
      });
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'btn btn-primary';
      confirm.textContent = '決定';
      confirm.disabled = draftItemPicks.size !== current.allowance;
      confirm.addEventListener('click', () => {
        net.send({ t: 'draftItems', indexes: [...draftItemPicks] });
        draftItemPicks = new Set();
      });
      items.push(confirm);
    }
  } else if (current.phase === 'start') {
    const myTurn = current.turnSeat === current.you;
    items.push(draftNote(myTurn ? '初期位置を選んでください。' : `${seatName(current.turnSeat ?? 0)}が初期位置を選んでいます…`));
    for (const start of current.starts) {
      items.push(
        choice(
          start.label,
          start.taken ? '選択済み' : '',
          '選ぶ',
          myTurn && !start.taken ? () => net.send({ t: 'draftStart', start: start.index }) : null,
        ),
      );
    }
  }
  const list = document.createElement('div');
  list.className = 'choice-list';
  list.append(...items);
  body.replaceChildren(list);

  $('draft-seats').replaceChildren(
    ...current.seats.map((seat) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = seatName(seat.id) + (seat.id === current.you ? '（あなた）' : '');
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = `${seat.job ? JOBS[seat.job].name : '職業未定'}／${TRAITS[seat.publicTrait].name}`;
      row.append(seatSprite(seat.id, seat.job), name, note);
      return row;
    }),
  );
}

// ―― 盤面 ――

function ensureMap(current: PlayerView) {
  if (builtSize === current.width) return;
  builtSize = current.width;
  const map = $('map');
  map.style.setProperty('--cols', String(current.width));
  map.replaceChildren();
  cellButtons = current.cells.map((cell) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    button.addEventListener('click', () => onCellTap(cell.x, cell.y));
    map.append(button);
    return button;
  });
}

const isGhost = (current: PlayerView) => !current.me.alive && !!current.ghost;
const canEdit = () => planning && !ready && !!view && (view.me.alive || isGhost(view));
const nameOf = (id: number) => view?.roster.find((p) => p.id === id)?.name ?? `P${id + 1}`;

/** 予約どおりに動いたときに通るマス */
function planPath(current: PlayerView): { x: number; y: number }[] {
  const path: { x: number; y: number }[] = [];
  let { x, y } = current.me;
  for (const action of plan) {
    if (action.type !== 'move') continue;
    x += DELTA[action.direction][0];
    y += DELTA[action.direction][1];
    path.push({ x, y });
  }
  return path;
}

function tryAdd(action: PlanAction) {
  if (!view || !canEdit()) return;
  const next = [...plan, action];
  const projection = projectPlan(view, next);
  if (!projection.ok) {
    if (action.type === 'attack') {
      toast(plan.some((a) => a.type === 'attack') ? '攻撃は1ターンに1回までです' : '予約できません（APか持ち物を確かめてください）');
    } else if (action.type === 'move') {
      toast(plan.some((a) => a.type === 'ambush') ? '待ち伏せと移動は一緒に予約できません' : describeRefusal(action));
    } else if (action.type === 'hide') {
      toast('隠れられるのは森と岩場だけです');
    } else if (action.type === 'ambush') {
      toast('待ち伏せは、動かず攻撃もしないターンにだけ予約できます');
    } else if (action.type === 'craft') {
      toast('APか素材が足りないか、持ち物がいっぱいか、ここには建てられません');
    } else {
      toast('APか持ち物が足りません');
    }
    return;
  }
  plan = next;
  sendPlan();
  render(false);
}

function describeRefusal(action: PlanAction): string {
  if (action.type !== 'move' || !view) return 'その予約はできません';
  const from = projectPlan(view, plan);
  const x = from.x + DELTA[action.direction][0];
  const y = from.y + DELTA[action.direction][1];
  const terrain = view.cells[y * view.width + x]?.terrain;
  if (terrain && TERRAIN[terrain].moveCost === null) return '海には入れません';
  return terrain ? `${TERRAIN[terrain].name}へ進むにはAPが${TERRAIN[terrain].moveCost}必要です` : 'APが足りません';
}

function sendPlan() {
  net.send({ t: 'plan', actions: plan, ready });
}

function onCellTap(x: number, y: number) {
  if (!view) return;
  if (canEdit() && view.me.alive) {
    const from = projectPlan(view, plan);
    const direction = (Object.keys(DELTA) as Direction[]).find(
      (d) => from.x + DELTA[d][0] === x && from.y + DELTA[d][1] === y,
    );
    // 人のいるマスは、移動か攻撃かを情報カードで選ぶ
    if (direction && !hasOthers(view.cells[y * view.width + x])) {
      inspected = null;
      tryAdd({ type: 'move', direction });
      return;
    }
  }
  inspected = { x, y };
  render(false);
}

const hasOthers = (cell: CellView) => cell.npcs.length > 0 || cell.figures.some((figure) => figure.kind !== 'self');

/** 情報カードの操作ボタン。名前は自由入力なので textContent で入れる */
function appendCellActions(info: HTMLElement, current: PlayerView, cell: CellView) {
  if (!canEdit() || !current.me.alive || !hasOthers(cell)) return;
  const box = document.createElement('div');
  box.className = 'cell-actions';
  const add = (label: string, onClick: () => void, className = 'btn') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    box.append(button);
  };

  // 昼は名前で選び、夜は人影としてマスを指定する
  const targets: { label: string; who?: number }[] = cell.figures.flatMap((f) =>
    f.kind === 'player' ? [{ label: f.name, who: f.id }] : [],
  );
  const myJob = current.roster.find((p) => p.id === current.me.id)?.job;
  const here = projectPlan(current, plan);
  const canHeal = (myJob === 'doctor' || current.secret.extraJob === 'doctor') && Math.max(Math.abs(here.x - cell.x), Math.abs(here.y - cell.y)) <= HEAL_RANGE;
  if (cell.figures.some((f) => f.kind === 'shadow')) targets.push({ label: '人影' });
  const owned = projectPlan(current, plan).owned;
  const canThrow = current.phase === 'day' && (owned[THROW_ITEM] ?? 0) > 0;
  const hasBottle = (owned[BOTTLE_ITEM] ?? 0) > 0;

  for (const target of targets) {
    const spot = { x: cell.x, y: cell.y, ...(target.who === undefined ? {} : { who: target.who }) };
    if (!isProtected(current)) {
      add(`${target.label}を攻撃（AP${ATTACK_AP}）`, () => {
        inspected = null;
        tryAdd({ type: 'attack', ...spot });
      }, 'btn btn-danger');
      if (canThrow) {
        add(`${target.label}に石を投げる（AP${ATTACK_AP}）`, () => {
          inspected = null;
          tryAdd({ type: 'attack', ...spot, throwStone: true });
        }, 'btn btn-danger');
      }
      if (hasBottle) {
        add(`${target.label}を瓶で殴る（AP${ATTACK_AP}・瓶は割れる）`, () => {
          inspected = null;
          tryAdd({ type: 'attack', ...spot, useBottle: true });
        }, 'btn btn-danger');
      }
    }
    if (canHeal) {
      add(`${target.label}を治療（AP${HEAL_AP}）`, () => {
        inspected = null;
        tryAdd({ type: 'heal', ...spot });
      }, 'btn btn-primary');
    }
    add(`${target.label}に密談を持ちかける（AP${WHISPER_AP}）`, () => {
      inspected = null;
      tryAdd({ type: 'whisper', ...spot });
    });
  }
  // 9.1 動物と漂流者
  for (const npc of cell.npcs) {
    if (npc.kind === 'castaway') {
      if (!npc.following && here.x === cell.x && here.y === cell.y) {
        add(`漂流者を手当てする（AP${AID_AP}）`, () => {
          inspected = null;
          tryAdd({ type: 'aid', npcId: npc.id });
        }, 'btn btn-primary');
      }
    } else {
      add(`${NPC_NAMES[npc.kind]}を狩る（AP${HUNT_AP}）`, () => {
        inspected = null;
        tryAdd({ type: 'hunt', npcId: npc.id });
      }, 'btn btn-danger');
    }
  }
  if (targets.length > 0) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = isProtected(current)
      ? '最初の2日間は攻撃できない'
      : '相手が動いても、残りAPで届くなら追いかける。届かなければ不発でAP−1';
    box.append(note);
  }

  const from = projectPlan(current, plan);
  const direction = (Object.keys(DELTA) as Direction[]).find(
    (d) => from.x + DELTA[d][0] === cell.x && from.y + DELTA[d][1] === cell.y,
  );
  if (direction) {
    add('このマスへ移動', () => {
      inspected = null;
      tryAdd({ type: 'move', direction });
    });
  }
  info.append(box);
}

const SIDES: [Direction, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
const layer = (src: string, className = '') => `<img src="${src}" alt="" class="${className}">`;

/** マスの絵を重ねる。下から地形→波打ちぎわ→建物→人の順 */
function cellLayers(cell: CellView, current: PlayerView, showPlanned: boolean): string {
  if (!cell.terrain) return layer(fogUrl(cell.x, cell.y));
  const parts = [layer(terrainUrl(cell.terrain, cell.x, cell.y))];
  if (cell.terrain === 'sea') parts.push(layer(waveUrl(cell.x, cell.y), 'wave'));
  else {
    for (const [side, dx, dy] of SIDES) {
      const next = current.cells[(cell.y + dy) * current.width + cell.x + dx];
      if (next?.x === cell.x + dx && next.terrain === 'sea') parts.push(layer(shoreUrl(side)));
    }
  }
  if (cell.footprint) parts.push(layer(footprintUrl()));
  if (cell.relic) parts.push(layer(relicUrl()));
  if (cell.structure) parts.push(layer(structureUrl(cell.structure)));
  for (const mark of current.marks) {
    if (mark.x === cell.x && mark.y === cell.y) parts.push(layer(markUrl(mark.kind)));
  }
  for (const npc of cell.npcs) parts.push(layer(npcUrl(npc.kind), 'npc'));
  // 名前は自由入力なので HTML に混ぜず、席番号だけを描く
  for (const figure of cell.figures) {
    if (figure.kind === 'shadow') {
      parts.push(layer(shadowUrl(), 'piece'));
      continue;
    }
    const job = current.roster.find((p) => p.id === figure.id)?.job ?? null;
    parts.push(layer(personUrl(job, figure.id), 'piece'));
    if (figure.kind === 'self') parts.push(layer(arrowUrl(), 'self-arrow'));
    parts.push(`<span class="seat-tag p${figure.id}">${figure.id + 1}</span>`);
  }
  if (isGhost(current) && current.me.x === cell.x && current.me.y === cell.y) parts.push(layer(ghostUrl(), 'piece'));
  if (showPlanned) {
    const job = current.roster.find((p) => p.id === current.me.id)?.job ?? null;
    parts.push(layer(personUrl(job, current.me.id), 'piece plan-ghost'));
  }
  if (current.whisperSeen.some((p) => p.x === cell.x && p.y === cell.y)) parts.push(layer(bubbleUrl()));
  return parts.join('');
}

function renderCell(button: HTMLButtonElement, cell: CellView, current: PlayerView) {
  const editing = canEdit() && current.me.alive;
  const from = projectPlan(current, plan);
  const distance = Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y);
  const cost = cell.terrain ? TERRAIN[cell.terrain].moveCost : 1;
  const canTarget = editing && distance === 1 && cost !== null;
  const onPath = planPath(current).some((p) => p.x === cell.x && p.y === cell.y);
  const planned = current.me.alive && plan.some((a) => a.type === 'move') && from.x === cell.x && from.y === cell.y;

  const classes = ['tile', `fog-${cell.fog}`];
  if (cell.terrain) classes.push(`t-${cell.terrain}`);
  if (canTarget) classes.push('reachable');
  if (canTarget && cost !== null && cost > from.ap) classes.push('too-far');
  if (onPath) classes.push('path');
  if (editing && !isProtected(current) && cell.figures.some((f) => f.kind !== 'self')) classes.push('can-attack');
  if (isGhost(current) && plan.some((a) => a.type === 'haunt' && a.x === cell.x && a.y === cell.y)) classes.push('ghost-target');
  if (current.marks.some((m) => m.kind === 'bounty' && Math.abs(m.x - cell.x) <= 1 && Math.abs(m.y - cell.y) <= 1)) classes.push('bounty-zone');
  if (inspected?.x === cell.x && inspected.y === cell.y) classes.push('inspected');
  button.className = classes.join(' ');

  const badge = canTarget ? `<span class="cost">${cell.terrain ? cost : '?'}</span>` : '';
  const worn = cell.depletion ? `<span class="worn" data-level="${cell.depletion}"></span>` : '';
  const html = `${cellLayers(cell, current, planned)}${worn}${badge}`;
  // 同じ絵を張り直すとちらつくので、変わったマスだけ書き換える
  if (cellHtml.get(button) !== html) {
    cellHtml.set(button, html);
    button.innerHTML = html;
  }
  const notes = [
    cell.terrain ? TERRAIN[cell.terrain].name : '未探索',
    cell.structure ? STRUCTURE_NAMES[cell.structure] : '',
    ...cell.npcs.map((n) => NPC_NAMES[n.kind]),
    cell.figures.length > 0 ? `${cell.figures.length}人` : '',
  ].filter(Boolean);
  button.setAttribute('aria-label', notes.join('、'));
}

/** 4.3 鷹の目：好きなマスを見る */
function appendScout(info: HTMLElement, current: PlayerView, cell: CellView) {
  if (!canEdit() || !projectPlan(current, [...plan, { type: 'scout', x: cell.x, y: cell.y }]).ok) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-small';
  button.textContent = 'このマスの周りを見る（鷹の目）';
  button.addEventListener('click', () => {
    inspected = null;
    tryAdd({ type: 'scout', x: cell.x, y: cell.y });
  });
  info.append(button);
}

function renderInfo(current: PlayerView) {
  const from = projectPlan(current, plan);
  const target = inspected ?? { x: from.x, y: from.y };
  const cell = current.cells[target.y * current.width + target.x];
  const info = $('info');
  if (!cell.terrain) {
    info.innerHTML = `<h2>未探索</h2><p class="muted">何があるか分からない。</p>`;
    appendScout(info, current, cell);
    return;
  }
  const def = TERRAIN[cell.terrain];
  const isHere = target.x === current.me.x && target.y === current.me.y;
  const isPlanned = !isHere && target.x === from.x && target.y === from.y;
  const prefix = isHere ? '現在地：' : isPlanned ? '予約の行き先：' : '';
  const memoryNote = cell.fog === 'known' ? '<p class="muted">記憶の中の地形。今の様子は見えない。</p>' : '';
  const cost = def.moveCost === null ? '進入不可' : `移動コスト ${def.moveCost}`;
  const worn =
    cell.depletion && cell.depletion > 0 ? `<p class="warn">採り尽くされ気味（枯渇 ${cell.depletion}）</p>` : '';
  info.innerHTML = `
    <h2>${prefix}${def.name} <span class="muted">${cost}</span></h2>
    <p>${def.summary}</p>
    ${isHere ? `<p class="muted">視界 半径${current.me.visionRadius}マス</p>` : ''}
    ${worn}${memoryNote}`;
  if (cell.structure) {
    const note = document.createElement('p');
    note.textContent = STRUCTURE_NOTES[cell.structure];
    info.append(note);
  }
  for (const npc of cell.npcs) {
    const note = document.createElement('p');
    note.textContent = npc.kind === 'castaway' && npc.following ? '漂流者が一緒にいる（採取しやすい）' : `${NPC_NAMES[npc.kind]}がいる`;
    info.append(note);
  }
  if (cell.footprint) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '足跡が残っている。何かが通ったようだ';
    info.append(note);
  }
  const mark = current.marks.find((m) => m.x === cell.x && m.y === cell.y);
  if (mark) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = MARK_NOTES[mark.kind];
    info.append(note);
  }
  appendScout(info, current, cell);
  if (isHere) {
    // 手紙は誰が書いたか分からない自由入力なので textContent で出す
    for (const text of current.letters) {
      const letter = document.createElement('p');
      letter.className = 'letter-note';
      letter.textContent = `手紙：${text}`;
      info.append(letter);
    }
  }
  appendCellActions(info, current, cell);
}

const tradeDrafts = new Map<number, { give: ItemId | ''; giveCount: number; take: ItemId; takeCount: number }>();

const smallButton = (label: string, onClick: () => void, className = 'btn btn-small') => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
};

const countSelect = (max: number, value: number, onChange: (n: number) => void) => {
  const select = document.createElement('select');
  select.className = 'count';
  for (let n = 1; n <= Math.max(1, max); n++) select.append(new Option(`×${n}`, String(n), false, n === value));
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
};

/** 6.2 取引と同盟。どちらも密談の相手とだけ */
function dealBox(current: PlayerView, whisper: PlayerView['whispers'][number]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'deal';
  const trade = whisper.trade;
  if (trade) {
    const line = document.createElement('p');
    line.className = 'deal-row';
    const status = { proposed: '返事待ち', agreed: '合意（実行で交換）', refused: '断られた', done: '済み' }[trade.status];
    line.textContent = `取引：${ITEMS[trade.give.item].name}×${trade.give.count}を渡し、${ITEMS[trade.take.item].name}×${trade.take.count}をもらう【${status}】`;
    box.append(line);
    if (trade.status === 'proposed' && !trade.mine) {
      const row = document.createElement('div');
      row.className = 'whisper-buttons';
      row.append(
        smallButton('取引に応じる', () => net.send({ t: 'tradeRespond', tradeId: trade.id, accept: true }), 'btn btn-small btn-primary'),
        smallButton('断る', () => net.send({ t: 'tradeRespond', tradeId: trade.id, accept: false })),
      );
      box.append(row);
    }
    if (trade.status === 'agreed' && canEdit()) {
      const betraying = plan.some((a) => a.type === 'withhold' && a.tradeId === trade.id);
      box.append(
        smallButton(betraying ? '約束どおり渡すことにする' : '約束を破って渡さない（裏切る）', () => {
          if (betraying) {
            plan = plan.filter((a) => !(a.type === 'withhold' && a.tradeId === trade.id));
            sendPlan();
            render(false);
          } else tryAdd({ type: 'withhold', tradeId: trade.id });
        }, betraying ? 'btn btn-small' : 'btn btn-small btn-danger'),
      );
    }
  } else if (whisper.withId !== null) {
    const draft = tradeDrafts.get(whisper.id) ?? { give: current.me.inventory[0]?.item ?? '', giveCount: 1, take: 'fruit' as ItemId, takeCount: 1 };
    tradeDrafts.set(whisper.id, draft);
    const giveRow = document.createElement('div');
    giveRow.className = 'deal-row';
    const giveSelect = document.createElement('select');
    giveSelect.setAttribute('aria-label', '渡す物');
    for (const stack of current.me.inventory) giveSelect.append(new Option(ITEMS[stack.item].name, stack.item, false, stack.item === draft.give));
    giveSelect.addEventListener('change', () => {
      draft.give = giveSelect.value as ItemId;
      draft.giveCount = 1;
      renderWhispers(current);
    });
    const owned = current.me.inventory.find((s) => s.item === draft.give)?.count ?? 1;
    giveRow.append('渡す', giveSelect, countSelect(owned, draft.giveCount, (n) => (draft.giveCount = n)));
    const takeRow = document.createElement('div');
    takeRow.className = 'deal-row';
    const takeSelect = document.createElement('select');
    takeSelect.setAttribute('aria-label', 'もらう物');
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      if (id !== 'full_course' && id !== 'island_lord') takeSelect.append(new Option(ITEMS[id].name, id, false, id === draft.take));
    }
    takeSelect.addEventListener('change', () => (draft.take = takeSelect.value as ItemId));
    takeRow.append('もらう', takeSelect, countSelect(STACK_SIZE, draft.takeCount, (n) => (draft.takeCount = n)));
    const propose = smallButton('この取引を持ちかける', () => {
      if (!draft.give) return;
      net.send({ t: 'tradePropose', id: whisper.id, give: { item: draft.give, count: draft.giveCount }, take: { item: draft.take, count: draft.takeCount } });
    });
    propose.disabled = current.me.inventory.length === 0;
    box.append(giveRow, takeRow, propose);
  }
  // 同盟
  const allied = (id: number) => current.alliances.some((a) => a.a === id || a.b === id);
  if (whisper.alliance === 'offeredToMe') {
    const row = document.createElement('div');
    row.className = 'whisper-buttons';
    row.append(
      smallButton('同盟に応じる', () => net.send({ t: 'allianceRespond', id: whisper.id, accept: true }), 'btn btn-small btn-primary'),
      smallButton('断る', () => net.send({ t: 'allianceRespond', id: whisper.id, accept: false })),
    );
    box.append(row);
  } else if (whisper.alliance === 'refused') {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '同盟の話はまとまらなかった';
    box.append(note);
  } else if (whisper.alliance === 'offeredByMe') {
    const wait = document.createElement('p');
    wait.className = 'muted';
    wait.textContent = '同盟の返事を待っています…';
    box.append(wait);
  } else if (whisper.withId !== null && !allied(current.me.id) && !allied(whisper.withId)) {
    const offer = smallButton('同盟を申し込む（全員に公開。互いの居場所が見える）', () => net.send({ t: 'alliancePropose', id: whisper.id }));
    box.append(offer);
  }
  return box;
}

function renderWhispers(current: PlayerView) {
  const hasAny = current.whispers.length > 0 || current.whisperSeen.length > 0;
  $('whisper-card').hidden = !hasAny;
  $('whisper-seen').hidden = current.whisperSeen.length === 0;
  const focusedId = document.activeElement instanceof HTMLInputElement ? document.activeElement.dataset.whisper : undefined;

  $('whisper-list').replaceChildren(
    ...current.whispers.map((whisper) => {
      const box = document.createElement('div');
      box.className = 'whisper';
      const partner = whisper.withId === null ? '人影' : nameOf(whisper.withId);
      const title = document.createElement('p');
      title.className = 'muted';
      title.textContent = whisper.status === 'pending' ? `${partner}から密談の誘い` : `${partner}との密談`;
      box.append(title);

      if (whisper.status === 'refused') {
        title.textContent = whisper.incoming ? `${partner}の誘いを断った` : `${partner}に断られた`;
        return box;
      }
      if (whisper.status === 'pending') {
        if (!whisper.incoming) {
          title.textContent = `${partner}の返事を待っています…`;
          return box;
        }
        const buttons = document.createElement('div');
        buttons.className = 'whisper-buttons';
        const accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'btn btn-small btn-primary';
        accept.textContent = '応じる';
        accept.addEventListener('click', () => net.send({ t: 'whisperRespond', id: whisper.id, accept: true }));
        const refuse = document.createElement('button');
        refuse.type = 'button';
        refuse.className = 'btn btn-small';
        refuse.textContent = '断る';
        refuse.addEventListener('click', () => net.send({ t: 'whisperRespond', id: whisper.id, accept: false }));
        buttons.append(accept, refuse);
        box.append(buttons);
        return box;
      }

      for (const message of whisper.messages) {
        const line = document.createElement('p');
        line.className = `whisper-line${message.mine ? ' mine' : ''}`;
        line.textContent = message.text;
        box.append(line);
      }
      if (planning) box.append(dealBox(current, whisper));
      const sent = whisper.messages.filter((m) => m.mine).length;
      const left = WHISPER.maxMessagesEach - sent;
      if (left <= 0 || !planning) {
        const note = document.createElement('p');
        note.className = 'muted';
        note.textContent = '送れるメッセージはもうありません';
        box.append(note);
        return box;
      }
      const form = document.createElement('form');
      form.className = 'whisper-form';
      const input = document.createElement('input');
      input.maxLength = WHISPER.maxLength;
      input.autocomplete = 'off';
      input.placeholder = `あと${left}通、${WHISPER.maxLength}文字まで`;
      input.setAttribute('aria-label', '密談のメッセージ');
      input.dataset.whisper = String(whisper.id);
      input.value = whisperDrafts.get(whisper.id) ?? '';
      input.addEventListener('input', () => whisperDrafts.set(whisper.id, input.value));
      const send = document.createElement('button');
      send.type = 'submit';
      send.className = 'btn btn-small';
      send.textContent = '送る';
      form.append(input, send);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!input.value.trim()) return;
        net.send({ t: 'whisperSend', id: whisper.id, text: input.value });
        whisperDrafts.delete(whisper.id);
        input.value = '';
      });
      box.append(form);
      return box;
    }),
  );

  if (focusedId !== undefined) {
    document.querySelector<HTMLInputElement>(`input[data-whisper="${focusedId}"]`)?.focus();
  }
}

/** 素材の表示。「木材×2、石×1」のように出す */
function inputsText(id: RecipeId): string {
  return RECIPES[id].inputs
    .map((set) => set.map(({ item, count }) => `${ITEMS[item].name}×${count}`).join('、'))
    .join(' または ');
}

/** 4章 自分の職業、特性、勝利条件の進み具合 */
function renderRole(current: PlayerView) {
  const me = current.roster.find((p) => p.id === current.me.id);
  const body = $('role-body');
  if (!me?.job) {
    $('role-card').hidden = true;
    return;
  }
  $('role-card').hidden = false;
  $('role-title').textContent = `あなたの役割：${JOBS[me.job].name}`;
  const lines: HTMLElement[] = [];
  const goal = document.createElement('p');
  goal.className = 'trait-line';
  goal.textContent = `勝利条件：${JOBS[me.job].goal}`;
  lines.push(goal);
  if (current.secret.extraJob) {
    const extra = document.createElement('p');
    extra.className = 'trait-line';
    extra.textContent = `秘密の職業「${JOBS[current.secret.extraJob].name}」：${JOBS[current.secret.extraJob].goal}`;
    lines.push(extra);
  }
  for (const line of current.goals) {
    const row = document.createElement('p');
    row.className = 'goal-line';
    const label = document.createElement('span');
    label.textContent = line.label;
    const value = document.createElement('b');
    value.textContent = line.value;
    row.append(label, value);
    lines.push(row);
  }
  if (me.publicTrait) lines.push(traitLine('公開特性', me.publicTrait, current));
  if (current.secret.trait) lines.push(traitLine('秘密特性', current.secret.trait, current));
  // 読心術：今の予約を覗く
  if (current.secret.trait === 'mind_reader' && !current.secret.used && planning) {
    for (const other of current.roster) {
      if (other.id === current.me.id || !other.alive) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small';
      button.textContent = `${other.name}の予約を覗く（読心術）`;
      button.addEventListener('click', () => net.send({ t: 'mindRead', targetId: other.id }));
      lines.push(button);
    }
  }
  body.replaceChildren(...lines);
}

/** 今いるマスでできる特別な行動。できるものだけ出す */
function renderSpecial(current: PlayerView) {
  const box = $('special-actions');
  if (!canEdit()) {
    box.replaceChildren();
    return;
  }
  const from = projectPlan(current, plan);
  const terrain = current.cells[from.y * current.width + from.x]?.terrain;
  const options: { label: string; action: PlanAction }[] = [{ label: `探索 ${EXPLORE_AP}AP`, action: { type: 'explore' } }];
  if (terrain === 'beach') options.push({ label: 'いかだ作り', action: { type: 'raftWork' } });
  options.push(
    { label: '砦を修理', action: { type: 'repair' } },
    { label: '建物を壊す', action: { type: 'smash' } },
    { label: '狼煙を消す', action: { type: 'extinguish' } },
    { label: 'いかだで脱出', action: { type: 'launch' } },
    { label: current.secret.radioFixed ? '無線で救助を呼ぶ' : '無線機を直す', action: { type: 'useRadio' } },
    { label: '偽の知らせ', action: { type: 'falseAlarm' } },
  );
  box.replaceChildren(
    ...options
      .filter(({ action }) => projectPlan(current, [...plan, action]).ok)
      .map(({ label, action }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-small';
        button.textContent = label;
        button.addEventListener('click', () => tryAdd(action));
        return button;
      }),
  );
}

/** 8.5 幽霊にできること。マスを選んでから怪異を置く */
function renderGhost(current: PlayerView) {
  const card = $('ghost-card');
  const body = $('ghost-body');
  const active = isGhost(current);
  card.hidden = !active;
  if (!active) return;
  const ghost = current.ghost!;
  const items: HTMLElement[] = [];
  const editing = canEdit();
  const can = (action: PlanAction) => editing && projectPlan(current, [...plan, action]).ok;
  const button = (label: string, icon: string, action: PlanAction) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'btn btn-small';
    element.append(spriteImg(iconUrl(icon)), document.createTextNode(label));
    element.disabled = !can(action);
    element.addEventListener('click', () => tryAdd(action));
    return element;
  };
  const note = document.createElement('p');
  note.className = 'muted';
  const target = inspected;
  note.textContent = !ghost.hauntReady
    ? '今日の怪異はもう使った'
    : target
      ? `選んだマス（${target.x + 1}, ${target.y + 1}）に怪異を起こせる`
      : 'マップのマスをタップして、怪異を起こす場所を選ぶ';
  items.push(note);
  if (target) {
    const grid = document.createElement('div');
    grid.className = 'ghost-buttons';
    for (const kind of Object.keys(HAUNT_NAMES) as HauntKind[]) {
      const element = button(HAUNT_NAMES[kind], kind, { type: 'haunt', kind, x: target.x, y: target.y });
      element.title = HAUNT_NOTES[kind];
      grid.append(element);
    }
    items.push(grid);
  }
  if (ghost.curseReady) items.push(button('自分を倒した相手に祟る', 'curse', { type: 'curse' }));
  body.replaceChildren(...items);
}

function renderRecipes(current: PlayerView) {
  const editing = canEdit();
  const myJob = current.roster.find((p) => p.id === current.me.id)?.job ?? null;
  // 職業専用のレシピは、作れる人にだけ見せる
  const available = (Object.keys(RECIPES) as RecipeId[]).filter((id) => {
    const job = RECIPES[id].job;
    return !job || job === myJob || job === current.secret.extraJob;
  });
  $('recipes').replaceChildren(
    ...available.map((id) => {
      const recipe = RECIPES[id];
      const row = document.createElement('li');
      const art = spriteImg(recipe.builds ? structureUrl(recipe.builds) : itemUrl(recipe.output!.item));
      const info = document.createElement('div');
      info.className = 'recipe-info';
      const name = document.createElement('b');
      name.textContent = `${recipe.name}（AP${recipeAp(recipe.ap, myJob)}）`;
      const detail = document.createElement('span');
      detail.className = 'muted';
      detail.textContent = recipe.course ? recipe.summary : `${inputsText(id)}。${recipe.summary}`;
      info.append(name, detail);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small';
      button.textContent = recipe.builds ? '建てる' : '作る';
      button.disabled = !editing || !projectPlan(current, [...plan, { type: 'craft', recipe: id }]).ok;
      button.addEventListener('click', () => tryAdd({ type: 'craft', recipe: id }));
      row.append(art, info, button);
      return row;
    }),
  );
  const canLetter = editing && projectPlan(current, [...plan, { type: 'letter', text: 'x' }]).ok;
  $<HTMLButtonElement>('letter-add').disabled = !canLetter;
}

function renderVitals(current: PlayerView) {
  const setValue = (id: string, value: number) => {
    const element = $(id);
    element.textContent = String(value);
    element.classList.toggle('low', value <= WEAK_THRESHOLD);
  };
  setValue('hunger-value', current.me.hunger);
  setValue('water-value', current.me.water);
  const tags = !current.me.alive ? [] : [
    current.me.bleeding ? '出血' : '',
    current.me.poisoned ? '中毒' : '',
    current.me.tired ? '疲労' : '',
    current.me.weak ? '弱っている' : '',
    current.me.hidden ? '隠れ中' : '',
  ].filter(Boolean);
  $('status-tags').replaceChildren(
    ...tags.map((tag) => {
      const element = document.createElement('span');
      element.className = 'tag tag-off';
      element.textContent = tag;
      return element;
    }),
  );
}

function renderMoreActions(current: PlayerView) {
  const editing = canEdit();
  const can = (action: PlanAction) => editing && projectPlan(current, [...plan, action]).ok;
  const setup = (id: string, label: string, action: PlanAction) => {
    const button = $<HTMLButtonElement>(id);
    button.querySelector('span')!.textContent = label;
    button.disabled = !can(action);
  };
  const ap = projectPlan(current, plan).ap;
  setup('act-rest', `休息 ${Math.max(0, ap)}AP`, { type: 'rest' });
  setup('act-guard', `防御 ${GUARD_AP}AP`, { type: 'guard' });
  setup('act-hide', `隠れる ${HIDE_AP}AP`, { type: 'hide' });
  setup('act-ambush', `待ち伏せ ${AMBUSH_AP}AP`, { type: 'ambush' });
}

function renderOrder() {
  if (!view) return;
  const current = view;
  $('order').replaceChildren(
    ...current.initiative.map(({ playerId, value }) => {
      const row = document.createElement('li');
      if (playerId === actingId) row.className = 'acting';
      const person = current.roster.find((p) => p.id === playerId);
      const portrait = person && !person.alive ? spriteImg(ghostUrl(), 'sprite sprite-person') : seatSprite(playerId, person?.job ?? null);
      const name = document.createElement('span');
      name.className = 'order-name';
      const public_ = [
        person?.job ? JOBS[person.job].name : '',
        person?.publicTrait ? TRAITS[person.publicTrait].name : '',
        person?.revealedTrait ? TRAITS[person.revealedTrait].name : '',
      ].filter(Boolean).join('・');
      name.textContent = nameOf(playerId) + (playerId === current.me.id ? '（あなた）' : '') + (public_ ? ` ${public_}` : '');
      const score = document.createElement('span');
      score.className = 'muted';
      score.textContent = `行動値 ${value}`;
      const state = document.createElement('span');
      const entry = status.find((s) => s.id === playerId);
      if (entry && !entry.connected) {
        state.className = 'tag tag-off';
        state.textContent = '切断中';
      } else if (entry?.ready && planning) {
        state.className = 'tag tag-ready';
        state.textContent = '確定';
      }
      const pact = current.alliances.find((a) => a.a === playerId || a.b === playerId);
      if (pact) {
        const ally = document.createElement('span');
        ally.className = 'tag tag-ally';
        ally.textContent = `同盟:${nameOf(pact.a === playerId ? pact.b : pact.a)}`;
        name.append(' ', ally);
      }
      row.append(portrait, name, score, state);
      return row;
    }),
  );
}

function renderPlan(current: PlayerView) {
  const list = $('plan-list');
  const projection = projectPlan(current, plan);
  $('plan-note').textContent = !planning
    ? ''
    : projection.uncertain
      ? '霧の中のコストは行ってみるまで分からない'
      : '';
  if (plan.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = !current.me.alive
      ? current.ghost
        ? '好きなマスをタップして怪異を選ぶ'
        : '脱落したので観戦中'
      : planning
        ? '隣のマスをタップして移動を予約'
        : '結果を見ています…';
    list.replaceChildren(empty);
    return;
  }
  let { x, y } = current.me;
  list.replaceChildren(
    ...plan.map((action) => {
      let terrain: TerrainId | null = null;
      if (action.type === 'move') {
        x += DELTA[action.direction][0];
        y += DELTA[action.direction][1];
        terrain = current.cells[y * current.width + x]?.terrain ?? null;
      }
      const item = document.createElement('li');
      item.textContent = describePlanAction(action, terrain, nameOf);
      return item;
    }),
  );
}

function render(centerOnPlayer: boolean) {
  if (!view) return;
  const current = view;
  document.body.dataset.phase = current.phase;
  updateMusic();
  current.cells.forEach((cell, i) => renderCell(cellButtons[i], cell, current));

  const projection = projectPlan(current, plan);
  $<HTMLImageElement>('phase-icon').src = iconUrl(current.phase === 'day' ? 'sun' : 'moon');
  document.body.dataset.weather = current.worldActive ? current.weather : 'sunny';
  $('weather-icon').hidden = !current.worldActive;
  $('weather-label').hidden = !current.worldActive;
  if (current.worldActive) {
    $<HTMLImageElement>('weather-icon').src = weatherIcon(current.weather);
    $('weather-label').textContent = WEATHER_NAMES[current.weather];
  }
  $('final-banner').hidden = !current.finalPhase;
  $('day-label').textContent = `${current.day}日目 ${current.phase === 'day' ? '昼' : '夜'}`;
  $('turn-label').textContent = `ターン ${current.turn}`;
  $('hp-value').textContent = current.me.alive ? `${current.me.hp}` : current.ghost ? '幽霊' : '脱落';
  $('ap-pips').innerHTML = Array.from(
    { length: BALANCE.apPerTurn },
    (_, i) => `<i class="${i < projection.ap ? 'on' : ''}"></i>`,
  ).join('');
  renderTimer();

  renderVitals(current);
  renderRole(current);
  renderSpecial(current);
  renderGhost(current);
  renderOrder();
  renderPlan(current);
  renderInfo(current);
  renderMoreActions(current);
  renderWhispers(current);
  renderRecipes(current);

  const editing = canEdit();
  $<HTMLButtonElement>('gather').disabled = !editing || !current.me.alive || projection.ap < GATHER_AP;
  $<HTMLButtonElement>('undo').disabled = !editing || plan.length === 0;
  const confirm = $<HTMLButtonElement>('confirm');
  confirm.disabled = !planning || (!current.me.alive && !current.ghost);
  $('confirm-label').textContent = !planning ? '実行中…' : ready ? '予約を修正する' : '予約を確定';
  confirm.classList.toggle('btn-primary', planning && !ready);

  renderInventory(current);
  $('log').replaceChildren(
    ...log.map((line) => {
      const row = document.createElement('li');
      row.textContent = line;
      return row;
    }),
  );

  if (centerOnPlayer) centerMap(current);
}

function renderInventory(current: PlayerView) {
  const inventory = $('inventory');
  $('slot-count').textContent = `${current.me.inventory.length} / ${current.slots}枠`;
  const planned = (item: ItemId) =>
    plan.filter((a) => (a.type === 'discard' || a.type === 'use') && a.item === item).length;
  inventory.replaceChildren(
    ...current.me.inventory.map((stack) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = ITEMS[stack.item].name;
      const count = document.createElement('span');
      const left = stack.count - planned(stack.item);
      count.className = 'count';
      count.textContent = left === stack.count ? `×${stack.count}` : `×${Math.max(0, left)}（予約済み）`;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.textContent = '捨てる';
      drop.disabled = !canEdit() || left <= 0;
      drop.setAttribute('aria-label', `${ITEMS[stack.item].name}を1つ捨てる`);
      drop.addEventListener('click', () => tryAdd({ type: 'discard', item: stack.item }));
      row.append(spriteImg(itemUrl(stack.item)), name, count);
      const effect = ITEMS[stack.item].use;
      if (effect) {
        const use = document.createElement('button');
        use.type = 'button';
        use.className = 'btn-use';
        use.textContent = effect.hunger ? '食べる' : effect.water ? '飲む' : '使う';
        use.disabled = !canEdit() || left <= 0;
        use.setAttribute('aria-label', `${ITEMS[stack.item].name}を使う（AP0）`);
        use.addEventListener('click', () => tryAdd({ type: 'use', item: stack.item }));
        row.append(use);
      }
      row.append(drop);
      return row;
    }),
  );
  if (current.me.inventory.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'muted';
    empty.textContent = 'まだ何も持っていない';
    inventory.append(empty);
  }
}

function renderTimer() {
  const timer = $('timer');
  if (!planning) {
    timer.textContent = '';
    timer.classList.remove('urgent');
    return;
  }
  const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  timer.textContent = `${seconds}秒`;
  timer.classList.toggle('urgent', seconds <= URGENT_SECONDS);
}

/** スマホではマップがはみ出すので、自分のマスが見える位置までスクロールする */
function centerMap(current: PlayerView, behavior: ScrollBehavior = 'smooth') {
  const scroller = $('map-scroll');
  const button = cellButtons[current.me.y * current.width + current.me.x];
  const frame = scroller.getBoundingClientRect();
  const cell = button.getBoundingClientRect();
  scroller.scrollTo({
    left: scroller.scrollLeft + cell.left - frame.left + cell.width / 2 - scroller.clientWidth / 2,
    top: scroller.scrollTop + cell.top - frame.top + cell.height / 2 - scroller.clientHeight / 2,
    behavior,
  });
}

// ―― 解決の再生 ――

function playReplay(steps: ReplayStep[], stepMs: number) {
  stopReplay();
  let index = 0;
  const next = () => {
    if (index >= steps.length) {
      actingId = null;
      render(false);
      return;
    }
    applyStep(steps[index++]);
    replayTimer = setTimeout(next, stepMs);
  };
  render(false);
  next();
}

function applyStep(step: ReplayStep) {
  const moved = !!step.view;
  if (step.view) view = step.view;
  playEvents(step.events);
  for (const event of step.events) {
    if (event.type === 'actorTurn') actingId = event.playerId;
    if (event.type === 'turnStarted') actingId = null;
    const text = view ? describeEvent(event, nameOf, view.me.id) : null;
    if (text) log.unshift(text);
  }
  log = log.slice(0, 60);
  render(moved);
}

function stopReplay() {
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null;
  actingId = null;
}

// ―― 操作 ――

function playerName(): string {
  const name = $<HTMLInputElement>('name').value.trim();
  try {
    localStorage.setItem('island-survival-name', name);
  } catch {
    // 名前を覚えられないだけなので問題ない
  }
  return name;
}

$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const seed = $<HTMLInputElement>('setup-seed').value.trim();
  net.send({
    t: 'create',
    name: playerName(),
    setup: {
      players: Number($<HTMLSelectElement>('setup-players').value),
      mapSize: $<HTMLSelectElement>('setup-size').value as MapSize,
      planSeconds: Number($<HTMLSelectElement>('setup-plan').value),
      cpuLevel: ($<HTMLSelectElement>('setup-cpu').value || null) as CpuLevel | null,
      ...(seed ? { seed } : {}),
    },
  });
});

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $<HTMLInputElement>('join-code').value.trim();
  $('join-error').hidden = true;
  if (code) net.send({ t: 'join', code, name: playerName() });
  else toast('合言葉を入れてください');
});

$('start-game').addEventListener('click', () => net.send({ t: 'start' }));
$('leave-room').addEventListener('click', () => net.send({ t: 'leave' }));
$('leave-result').addEventListener('click', () => net.send({ t: 'leave' }));
$('leave-game').addEventListener('click', () => {
  if (window.confirm('このゲームから抜けますか？ 抜けると戻れません。')) net.send({ t: 'leave' });
});
$('back-to-lobby').addEventListener('click', () => net.send({ t: 'backToLobby' }));
$('copy-invite').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast('招待URLをコピーしました');
  } catch {
    toast('コピーできませんでした。URLを長押しで選んでください');
  }
});

$('act-rest').addEventListener('click', () => tryAdd({ type: 'rest' }));
$('act-guard').addEventListener('click', () => tryAdd({ type: 'guard' }));
$('act-hide').addEventListener('click', () => tryAdd({ type: 'hide' }));
$('act-ambush').addEventListener('click', () => tryAdd({ type: 'ambush' }));
$('letter-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('letter-text');
  const text = input.value.trim().slice(0, LETTER.maxLength);
  if (!text) {
    toast('手紙の内容を入れてください');
    return;
  }
  tryAdd({ type: 'letter', text });
  if (plan.some((a) => a.type === 'letter' && a.text === text)) input.value = '';
});
$('gather').addEventListener('click', () => tryAdd({ type: 'gather' }));
$('undo').addEventListener('click', undo);
$('confirm').addEventListener('click', toggleReady);

function undo() {
  if (!canEdit() || plan.length === 0) return;
  plan = plan.slice(0, -1);
  sendPlan();
  render(false);
}

function toggleReady() {
  if (!planning || !view || (!view.me.alive && !view.ghost)) return;
  ready = !ready;
  sendPlan();
  render(false);
}

window.addEventListener('keydown', (event) => {
  if ($('screen-game').hidden) return;
  const target = event.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;
  const direction = KEY_DIRECTION[event.key];
  if (direction) {
    event.preventDefault();
    inspected = null;
    tryAdd({ type: 'move', direction });
  } else if (event.key === 'g') {
    tryAdd({ type: 'gather' });
  } else if (event.key === 'z' || event.key === 'Backspace') {
    undo();
  } else if (event.key === 'e') {
    toggleReady();
  }
});

setInterval(() => {
  if (!$('screen-game').hidden) renderTimer();
  if (!$('screen-draft').hidden) {
    $('draft-timer').textContent = `${Math.max(0, Math.ceil((draftDeadline - Date.now()) / 1000))}秒`;
  }
}, 250);

// 端末の回転などで画面の大きさが変わっても、自分のマスを見失わないようにする
new ResizeObserver(() => {
  if (view && !$('screen-game').hidden) centerMap(view, 'auto');
}).observe($('map-scroll'));

// ―― 絵の準備 ――
document.querySelectorAll<HTMLImageElement>('img[data-icon]').forEach((img) => {
  img.src = iconUrl(img.dataset.icon!);
});
$('weather-layer').style.backgroundImage = `url(${rainUrl()})`;

// 2コマのアニメーションはすべてこの拍子に合わせる
const FRAME_MS = 600;
let frame = 0;
document.body.dataset.frame = '0';
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  setInterval(() => {
    frame = 1 - frame;
    document.body.dataset.frame = String(frame);
  }, FRAME_MS);
}

// スマホは画面を触るまで音を出せない。最初の操作で音を有効にする
const unlockSound = () => {
  sound.unlock();
  updateMusic();
};
window.addEventListener('pointerdown', unlockSound, { once: true });
window.addEventListener('keydown', unlockSound, { once: true });
renderSoundControls();

watchSlowConnect();
try {
  $<HTMLInputElement>('name').value = localStorage.getItem('island-survival-name') ?? '';
} catch {
  // 名前を覚えていなくても問題ない
}
