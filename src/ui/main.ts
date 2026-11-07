// 画面。サーバーから届いた見え方だけで描く。ルールの判定はサーバーが行い、画面は見込みの計算だけをする。
import {
  ATTACK_AP,
  GATHER_AP,
  INVENTORY_SLOTS,
  isProtected,
  ITEMS,
  MAP_SIZE_NAMES,
  projectPlan,
  TERRAIN,
  type CellView,
  type Direction,
  type ItemId,
  type MapSize,
  type PlanAction,
  type PlayerView,
  type ReplayStep,
  type TerrainId,
} from '../core/index';
import type { PlanStatus, ServerMessage } from '../net/protocol';
import { Net } from './net';
import { describeEvent, describePlanAction } from './text';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const GLYPH: Record<TerrainId, string> = {
  sea: '',
  beach: '砂',
  grass: '草',
  forest: '森',
  rock: '岩',
  mountain: '山',
  spring: '泉',
  river: '川',
  cave: '洞',
  wreck: '船',
  ruins: '遺',
};

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
const AP_DISPLAY = 3;
const URGENT_SECONDS = 10;
const SLOW_CONNECT_MS = 15_000;
const ERROR_TOAST_MS = 6000;
const TOAST_MS = 2600;

type Screen = 'home' | 'lobby' | 'game' | 'result';

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
let builtSize = 0;
let replayTimer: ReturnType<typeof setTimeout> | null = null;
let actingId: number | null = null;
let hostCanStart = false;
let inviteUrl = '';
/** URLで招待されている合言葉。別のルームの席が残っていても、こちらを優先する */
let invitedCode = new URLSearchParams(location.search).get('room')?.trim().toUpperCase() ?? '';
let switchingRoom = false;

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

function showScreen(screen: Screen) {
  $('screen-home').hidden = screen !== 'home';
  $('screen-lobby').hidden = screen !== 'lobby';
  $('screen-game').hidden = screen !== 'game';
  $('screen-result').hidden = screen !== 'result';
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
      const dot = document.createElement('span');
      dot.className = `dot p${member.id}`;
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
      row.append(dot, name, note);
      return row;
    }),
  );
  const seed = message.setup.seed ? `・シード値 ${message.setup.seed}` : '';
  $('lobby-rules').textContent = `広さ「${MAP_SIZE_NAMES[message.setup.mapSize]}」・ターンの長さ ${message.setup.planSeconds}秒${seed}`;
  $('start-game').hidden = !hostCanStart;
  $('lobby-wait').hidden = hostCanStart;
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

const canEdit = () => planning && !ready && !!view?.me.alive;
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
      toast(plan.some((a) => a.type === 'attack') ? '攻撃は1ターンに1回までです' : 'APが足りません');
    } else {
      toast(action.type === 'gather' ? 'APが足りません' : describeRefusal(action));
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
  if (canEdit()) {
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

const hasOthers = (cell: CellView) => cell.figures.some((figure) => figure.kind !== 'self');

/** 情報カードの操作ボタン。名前は自由入力なので textContent で入れる */
function appendCellActions(info: HTMLElement, current: PlayerView, cell: CellView) {
  if (!canEdit() || !hasOthers(cell)) return;
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

  if (isProtected(current)) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '最初の2日間は攻撃できない';
    box.append(note);
  } else {
    const named = cell.figures.flatMap((f) => (f.kind === 'player' ? [f] : []));
    for (const figure of named) {
      add(`${figure.name}を攻撃（AP${ATTACK_AP}）`, () => {
        inspected = null;
        tryAdd({ type: 'attack', x: cell.x, y: cell.y, who: figure.id });
      }, 'btn btn-danger');
    }
    if (cell.figures.some((f) => f.kind === 'shadow')) {
      add(`人影を攻撃（AP${ATTACK_AP}）`, () => {
        inspected = null;
        tryAdd({ type: 'attack', x: cell.x, y: cell.y });
      }, 'btn btn-danger');
    }
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = '相手が動いても、残りAPで届くなら追いかける。届かなければ不発でAP−1';
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

function renderCell(button: HTMLButtonElement, cell: CellView, current: PlayerView) {
  const editing = canEdit();
  const from = projectPlan(current, plan);
  const distance = Math.abs(cell.x - from.x) + Math.abs(cell.y - from.y);
  const cost = cell.terrain ? TERRAIN[cell.terrain].moveCost : 1;
  const canTarget = editing && distance === 1 && cost !== null;
  const onPath = planPath(current).some((p) => p.x === cell.x && p.y === cell.y);
  const isGhost = plan.some((a) => a.type === 'move') && from.x === cell.x && from.y === cell.y;

  const classes = ['tile', `fog-${cell.fog}`];
  if (cell.terrain) classes.push(`t-${cell.terrain}`);
  if (canTarget) classes.push('reachable');
  if (canTarget && cost !== null && cost > from.ap) classes.push('too-far');
  if (onPath) classes.push('path');
  if (editing && !isProtected(current) && hasOthers(cell)) classes.push('can-attack');
  if (inspected?.x === cell.x && inspected.y === cell.y) classes.push('inspected');
  button.className = classes.join(' ');

  // 名前は自由入力なので HTML に混ぜず、席番号だけを描く
  const pieces = cell.figures
    .map((figure) => {
      if (figure.kind === 'shadow') return '<span class="piece shadow" aria-label="人影"></span>';
      const self = figure.kind === 'self' ? ' self' : '';
      return `<span class="piece p${figure.id}${self}">${figure.id + 1}</span>`;
    })
    .join('');
  const ghost = isGhost ? `<span class="piece ghost p${current.me.id}">${current.me.id + 1}</span>` : '';
  const label = cell.terrain && cell.terrain !== 'sea' ? `<span class="glyph">${GLYPH[cell.terrain]}</span>` : '';
  const badge = canTarget ? `<span class="cost">${cell.terrain ? cost : '?'}</span>` : '';
  const worn = cell.depletion ? `<span class="worn" data-level="${cell.depletion}"></span>` : '';
  const relic = cell.relic ? '<span class="relic" aria-label="遺品">✝</span>' : '';
  button.innerHTML = `${label}${worn}${relic}${pieces}${ghost}${badge}`;
  button.setAttribute('aria-label', cell.terrain ? TERRAIN[cell.terrain].name : '未探索');
}

function renderInfo(current: PlayerView) {
  const from = projectPlan(current, plan);
  const target = inspected ?? { x: from.x, y: from.y };
  const cell = current.cells[target.y * current.width + target.x];
  const info = $('info');
  if (!cell.terrain) {
    info.innerHTML = `<h2>未探索</h2><p class="muted">何があるか分からない。</p>`;
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
  appendCellActions(info, current, cell);
}

function renderOrder() {
  if (!view) return;
  const current = view;
  $('order').replaceChildren(
    ...current.initiative.map(({ playerId, value }) => {
      const row = document.createElement('li');
      if (playerId === actingId) row.className = 'acting';
      const dot = document.createElement('span');
      dot.className = `dot p${playerId}`;
      const name = document.createElement('span');
      name.className = 'order-name';
      name.textContent = nameOf(playerId) + (playerId === current.me.id ? '（あなた）' : '');
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
      row.append(dot, name, score, state);
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
      ? '脱落したので観戦中'
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
  current.cells.forEach((cell, i) => renderCell(cellButtons[i], cell, current));

  const projection = projectPlan(current, plan);
  $('phase-icon').textContent = current.phase === 'day' ? '☀' : '☾';
  $('day-label').textContent = `${current.day}日目 ${current.phase === 'day' ? '昼' : '夜'}`;
  $('turn-label').textContent = `ターン ${current.turn}`;
  $('hp-value').textContent = current.me.alive ? `${current.me.hp}` : '脱落';
  $('ap-pips').innerHTML = Array.from(
    { length: AP_DISPLAY },
    (_, i) => `<i class="${i < projection.ap ? 'on' : ''}"></i>`,
  ).join('');
  renderTimer();

  renderOrder();
  renderPlan(current);
  renderInfo(current);

  const editing = canEdit();
  $<HTMLButtonElement>('gather').disabled = !editing || projection.ap < GATHER_AP;
  $<HTMLButtonElement>('undo').disabled = !editing || plan.length === 0;
  const confirm = $<HTMLButtonElement>('confirm');
  confirm.disabled = !planning || !current.me.alive;
  confirm.textContent = !planning ? '解決中…' : ready ? '予約を修正する' : '予約を確定';
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
  $('slot-count').textContent = `${current.me.inventory.length} / ${INVENTORY_SLOTS}枠`;
  const planned = (item: ItemId) => plan.filter((a) => a.type === 'discard' && a.item === item).length;
  inventory.replaceChildren(
    ...current.me.inventory.map((stack) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = ITEMS[stack.item].name;
      const count = document.createElement('span');
      const left = stack.count - planned(stack.item);
      count.className = 'count';
      count.textContent = left === stack.count ? `×${stack.count}` : `×${left}（捨てる予約）`;
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.textContent = '捨てる';
      drop.disabled = !canEdit() || left <= 0;
      drop.setAttribute('aria-label', `${ITEMS[stack.item].name}を1つ捨てる`);
      drop.addEventListener('click', () => tryAdd({ type: 'discard', item: stack.item }));
      row.append(name, count, drop);
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
  if (!planning || !view?.me.alive) return;
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
}, 250);

// 端末の回転などで画面の大きさが変わっても、自分のマスを見失わないようにする
new ResizeObserver(() => {
  if (view && !$('screen-game').hidden) centerMap(view, 'auto');
}).observe($('map-scroll'));

watchSlowConnect();
try {
  $<HTMLInputElement>('name').value = localStorage.getItem('island-survival-name') ?? '';
} catch {
  // 名前を覚えていなくても問題ない
}
