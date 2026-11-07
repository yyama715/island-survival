// 画面。サーバーから届いた見え方だけで描く。ルールの判定はサーバーが行い、画面は見込みの計算だけをする。
import {
  AMBUSH_AP,
  ATTACK_AP,
  BOTTLE_ITEM,
  GATHER_AP,
  GUARD_AP,
  HIDE_AP,
  INVENTORY_SLOTS,
  isProtected,
  ITEMS,
  LETTER,
  MAP_SIZE_NAMES,
  projectPlan,
  RECIPES,
  TERRAIN,
  THROW_ITEM,
  WEAK_THRESHOLD,
  WHISPER,
  WHISPER_AP,
  type CellView,
  type Direction,
  type ItemId,
  type MapSize,
  type PlanAction,
  type PlayerView,
  type RecipeId,
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
    case 'whisperUpdate':
      if (view) {
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

  // 昼は名前で選び、夜は人影としてマスを指定する
  const targets: { label: string; who?: number }[] = cell.figures.flatMap((f) =>
    f.kind === 'player' ? [{ label: f.name, who: f.id }] : [],
  );
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
    add(`${target.label}に密談を持ちかける（AP${WHISPER_AP}）`, () => {
      inspected = null;
      tryAdd({ type: 'whisper', ...spot });
    });
  }
  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = isProtected(current)
    ? '最初の2日間は攻撃できない'
    : '相手が動いても、残りAPで届くなら追いかける。届かなければ不発でAP−1';
  box.append(note);

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
  if (current.whisperSeen.some((p) => p.x === cell.x && p.y === cell.y)) classes.push('whisper-seen');
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
  const structure =
    cell.structure === 'hut'
      ? '<span class="structure" aria-label="小屋">⌂</span>'
      : cell.structure === 'trap'
        ? '<span class="structure" aria-label="自分の罠">×</span>'
        : '';
  button.innerHTML = `${label}${worn}${relic}${structure}${pieces}${ghost}${badge}`;
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
  if (cell.structure) {
    const note = document.createElement('p');
    note.textContent = cell.structure === 'hut' ? '小屋がある（休息の回復が倍）' : '自分の置いた罠がある';
    info.append(note);
  }
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

function renderRecipes(current: PlayerView) {
  const editing = canEdit();
  $('recipes').replaceChildren(
    ...(Object.keys(RECIPES) as RecipeId[]).map((id) => {
      const recipe = RECIPES[id];
      const row = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'recipe-info';
      const name = document.createElement('b');
      name.textContent = `${recipe.name}（AP${recipe.ap}）`;
      const detail = document.createElement('span');
      detail.className = 'muted';
      detail.textContent = `${inputsText(id)}。${recipe.summary}`;
      info.append(name, detail);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-small';
      button.textContent = recipe.builds ? '建てる' : '作る';
      button.disabled = !editing || !projectPlan(current, [...plan, { type: 'craft', recipe: id }]).ok;
      button.addEventListener('click', () => tryAdd({ type: 'craft', recipe: id }));
      row.append(info, button);
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
  const tags = [
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
    button.textContent = label;
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

  renderVitals(current);
  renderOrder();
  renderPlan(current);
  renderInfo(current);
  renderMoreActions(current);
  renderWhispers(current);
  renderRecipes(current);

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
  const planned = (item: ItemId) =>
    plan.filter((a) => (a.type === 'discard' || a.type === 'use') && a.item === item).length;
  inventory.replaceChildren(
    ...current.me.inventory.map((stack) => {
      const row = document.createElement('li');
      const name = document.createElement('span');
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
      row.append(name, count);
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
