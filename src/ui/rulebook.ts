// ユーザー向けのルールブック。数値はルール本体のデータから読むので、調整してもずれない。
// 画面で開くと A4 の見た目になり、そのまま PDF に印刷できる。
import '@fontsource/dotgothic16';
import {
  AID_AP,
  AMBUSH_AP,
  ATTACK_AP,
  BALANCE,
  COMBAT,
  EARLY_PROTECTION_TURNS,
  EXPLORE_AP,
  FINAL,
  GATHER_AP,
  GOALS,
  GUARD_AP,
  HIDE_AP,
  HUNT_AP,
  INITIAL_HP,
  INITIAL_HUNGER,
  INITIAL_WATER,
  INVENTORY_SLOTS,
  ITEMS,
  JOB_IDS,
  JOBS,
  LETTER_AP,
  RARITY_NAMES,
  RARITY_ORDER,
  RECIPES,
  SMOKE,
  TERRAIN,
  TRAITS,
  WEATHER,
  WHISPER,
  WHISPER_AP,
  type RecipeId,
  type TerrainId,
  type TraitId,
  CASTAWAY_REWARDS,
  DEPLETION,
  DRINK_AT_SOURCE,
  FISHER_FISH_MULTIPLIER,
  FOLLOWER_GATHER,
  LOST_SENSE_GATHER,
  NEST_HIT_BONUS,
  NIGHT_GATHER_PENALTY,
  NPC_MEAT,
  PITY_AFTER_DRY_STREAK,
  RIVER_FISH_CHANCE,
  SPECIAL_LOOT,
  SPECIAL_REPEAT_NOTHING_CHANCE,
  SPECIAL_TERRAINS,
  SUPPLY_ITEMS,
  BOTTLE_ITEM,
  GENRE_NAMES,
  ITEM_GENRE,
  LETTER,
  RAFT,
  THROW_ITEM,
  WEAPONS,
  type ItemId,
  type ItemRoll,
} from '../core/index';
import titleImage from './title.webp';
import { iconUrl, itemUrl, personUrl, structureUrl, terrainUrl } from './sprites';

const img = (src: string) => `<img src="${src}" alt="">`;
const dayOf = (turn: number) => Math.ceil(turn / 2);
const inputs = (id: RecipeId) =>
  RECIPES[id].course
    ? `食材${GOALS.courseGenres}ジャンル`
    : RECIPES[id].inputs.map((set) => set.map(({ item, count }) => `${ITEMS[item].name}×${count}`).join('、')).join(' または ');

const terrains: TerrainId[] = ['beach', 'grass', 'forest', 'rock', 'mountain', 'spring', 'river', 'cave', 'wreck', 'ruins'];
const recipes: RecipeId[] = ['stone_knife', 'spear', 'bow', 'bandage', 'rope', 'fishing_rod', 'hut', 'campfire', 'smoke', 'sail'];
/** 特性の使い方を短く。ボタンで使うもの、明かされるものも書く */
const SHORT_USES = { always: 'ずっと', turn: '毎ターン', daily: '1日1回', once: '1回だけ', start: '開始時' } as const;
const usageNote = (id: TraitId) => {
  const def = TRAITS[id];
  return [SHORT_USES[def.uses], def.action ? 'ボタン' : '', def.secret && def.reveals ? '公開' : ''].filter(Boolean).join('・');
};

const traitRows = (secret: boolean) =>
  (Object.keys(TRAITS) as TraitId[])
    .filter((id) => TRAITS[id].secret === secret)
    // レア度の低い順（コモン→レア→スーパーレア→伝説）
    .sort((x, y) => RARITY_ORDER.indexOf(TRAITS[x].rarity) - RARITY_ORDER.indexOf(TRAITS[y].rarity))
    .map((id) => `<tr><th>${TRAITS[id].name}</th><td class="num">${RARITY_NAMES[TRAITS[id].rarity]}<br><span class="use">${usageNote(id)}</span></td><td>${TRAITS[id].text}</td></tr>`)
    .join('');

/** 自分を真ん中にした5×5のマス目。kind は相手がそのマスにいたときの届き方 */
function reachGrid(title: string, note: string, kind: (dx: number, dy: number) => string): string {
  const cells: string[] = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const me = dx === 0 && dy === 0;
      cells.push(`<i class="${kind(dx, dy)}${me ? ' me' : ''}">${me ? '自' : ''}</i>`);
    }
  }
  return `<figure><b>${title}</b><div class="grid">${cells.join('')}</div><figcaption>${note}</figcaption></figure>`;
}

const page1 = `
<section class="page">
  <div class="cover">
    <div>
      <h1 class="pixel">無人島サバイバル</h1>
      <p class="lead pixel">この島から脱出できるのは1人だけ</p>
      <p>3〜6人で遊ぶ、ブラウザのオンライン対戦ゲーム。全員が同時に行動を「予約」し、決まった順番で一斉に動く。協力したいけど、信用しきれない。</p>
      <p class="tiny">1ゲーム 約30〜50分／スマホ・PC どちらでも参加できる／ボイスチャット推奨</p>
    </div>
    <img src="${titleImage}" alt="">
  </div>

  <h2 class="pixel">勝ち方（勝者はいつも1人）</h2>
  <div class="cols">
    <div>
      <h3>みんなが狙える勝ち方</h3>
      <ul>
        <li><b>最後の1人</b>：ほかの全員が脱落したら勝ち</li>
        <li><b>救助船</b>：山で狼煙を上げると、${SMOKE.shipDelayTurns}ターン後に救助船が砂浜へ来る（着く場所は上げた人だけが先に知る）。最初に乗った人の勝ち</li>
        <li><b>いかだ</b>：砂浜で木材・ロープ・帆を集めていかだを作り、脱出する</li>
      </ul>
    </div>
    <div>
      <h3>職業ごとの特殊勝利</h3>
      <p>職業ごとに、自分だけの勝ち方がある（3ページ目）。進み具合は本人にしか見えないが、誰かがあと1歩になると全員に「誰かが勝利目前！」と知らされ、その人がいるあたり3×3が<b>賞金首</b>として地図に出る。</p>
      <p class="tiny">${dayOf(FINAL.startTurn)}日目からは最終局面になり、特殊勝利はできなくなる。</p>
    </div>
  </div>

  <h2 class="pixel">ゲームの準備</h2>
  <ol>
    <li>1人がルームを作り、招待URLか4文字の合言葉を友だちに送る。空いた席はCPUで埋められる</li>
    <li><b>特性</b>が配られる。公開特性（みんなに見える）と秘密特性（自分だけ）の2つ。公開特性は1回だけ引き直せる（代わりに初期所持品が1つ減る）</li>
    <li>順番に<b>職業</b>を選ぶ（同じ職業は選べない。職業は全員に公開）。続けて初期所持品と、スタート地点を選ぶ</li>
  </ol>

  <h2 class="pixel">1ターンの流れ</h2>
  <p>1日は昼と夜の2ターン。ターンの始めに全員の<b>行動順</b>（機敏さ＋サイコロ）が公開される。</p>
  <div class="flow">
    <div><strong>① 計画（60秒か120秒）</strong>行動をAPの範囲で予約する。隣のマスをタップで移動、ボタンで採取など。決まったら「予約を確定」</div>
    <div><strong>② 実行</strong>行動順に1人ずつ、予約どおりに動く。先に動いた人の結果で、後の人の予定が狂うこともある</div>
    <div><strong>③ 結果</strong>見えた範囲の出来事が届く。霧の向こうで起きたことは分からない</div>
  </div>

  <h2 class="pixel">ステータス</h2>
  <table>
    <tr><th class="icon"></th><th>項目</th><th>はじめ</th><th>減り方</th><th>0になると</th></tr>
    <tr><td class="icon">${img(iconUrl('heart'))}</td><th>HP</th><td class="num">${INITIAL_HP}</td><td>攻撃、空腹、渇き、出血など</td><td>脱落（幽霊になる）</td></tr>
    <tr><td class="icon">${img(iconUrl('hunger'))}</td><th>満腹度</th><td class="num">${INITIAL_HUNGER}</td><td>昼ターンごとに−1（夜は減らない）</td><td>毎ターンHP−1</td></tr>
    <tr><td class="icon">${img(iconUrl('water'))}</td><th>水分</th><td class="num">${INITIAL_WATER}</td><td>昼ターンごとに−1。晴れの日はさらに−${WEATHER.sunnyWater}</td><td>毎ターンHP−2</td></tr>
    <tr><td class="icon">${img(iconUrl('ap'))}</td><th>AP</th><td class="num">${BALANCE.apPerTurn}</td><td>毎ターン${BALANCE.apPerTurn}に戻る。行動で使う</td><td>そのターンはもう動けない</td></tr>
  </table>
  <p>満腹度と水分がどちらも3以下だと「弱っている」状態になり、APが1減る。出血は毎ターンHP−1（包帯で止まる）、疲れると次のターンのAPが1減る。持ち物は${INVENTORY_SLOTS}枠（リュックで増える）。</p>

  <h2 class="pixel">霧と視界</h2>
  <p>マップは最初ほとんど霧に包まれている。歩くと晴れていき、一度見た地形は覚えているが、今そこに誰がいるかは見えない。<b>森</b>は外から奥が見えず、<b>山</b>は遠くまで見渡せる。<b>夜</b>は視界が狭く、人は「人影」としか分からない。</p>
  <h2 class="pixel">駆け引き</h2>
  <div class="cols">
    <ul>
      <li><b>取引</b>：密談の中で「これを渡すから、あれをくれ」と持ちかけ、相手が応じれば成立。実行のとき、行動順が先の人の手番で同時に交換する。<b>約束を破って渡さない</b>予約もできる</li>
      <li><b>同盟</b>：密談の中で申し込み、相手が応じると全員に公開される。同盟相手の居場所は霧の中でも見える。1人1つまで。同盟相手を攻撃すると全員に「裏切り」と知らされる</li>
    </ul>
    <ul>
      <li><b>焚き火</b>（木材2）：そこで食べると回復+1、夜は周りが明るい。ただし煙は全員に見える。4ターンで消える</li>
      <li><b>医師の治療</b>は同じマスか隣のマスの相手に届く</li>
    </ul>
  </div>
  <p class="foot">1 / 5</p>
</section>`;

const page2 = `
<section class="page">
  <h2 class="pixel">行動とAP</h2>
  <div class="cols">
    <table>
      <tr><th>行動</th><th>AP</th><th>内容</th></tr>
      <tr><th>移動</th><td class="num">地形ごと</td><td>上下左右に1マス。コストは下の地形表</td></tr>
      <tr><th>採取</th><td class="num">${GATHER_AP}</td><td>今いるマスで素材や食料を探す。泉・川では水を飲める</td></tr>
      <tr><th>攻撃</th><td class="num">${ATTACK_AP}</td><td>1ターンに1回。相手が動いても、残りAPで届けば追いかける</td></tr>
      <tr><th>クラフト</th><td class="num">道具ごと</td><td>素材から道具や建物を作る</td></tr>
      <tr><th>使う・食べる</th><td class="num">0</td><td>食料、水、包帯、薬など</td></tr>
      <tr><th>休息</th><td class="num">残り全部</td><td>残りのAPぶんHPが回復（小屋なら倍）</td></tr>
    </table>
    <table>
      <tr><th>行動</th><th>AP</th><th>内容</th></tr>
      <tr><th>防御</th><td class="num">${GUARD_AP}</td><td>受けるダメージが減り、隠れた人や罠に気づく</td></tr>
      <tr><th>隠れる</th><td class="num">${HIDE_AP}</td><td>森と岩場だけ。見つかりにくくなる</td></tr>
      <tr><th>待ち伏せ</th><td class="num">${AMBUSH_AP}</td><td>動かないターンに。このマスに来た人を先に攻撃</td></tr>
      <tr><th>探索</th><td class="num">${EXPLORE_AP}</td><td>このターンの視界+1</td></tr>
      <tr><th>密談</th><td class="num">${WHISPER_AP}</td><td>同じマスか隣の人と、各${WHISPER.maxMessagesEach}通・${WHISPER.maxLength}文字まで内緒話</td></tr>
      <tr><th>手紙</th><td class="num">${LETTER_AP}</td><td>木材1個。このマスに来た人が読める</td></tr>
      <tr><th>狩り・手当て</th><td class="num">${HUNT_AP}・${AID_AP}</td><td>動物を狩ると肉。漂流者を助けるとお礼と同行</td></tr>
    </table>
  </div>

  <h2 class="pixel">地形</h2>
  <table>
    <tr><th class="icon"></th><th>地形</th><th>移動</th><th>採れるもの・特徴</th><th class="icon"></th><th>地形</th><th>移動</th><th>採れるもの・特徴</th></tr>
    ${[0, 2, 4, 6, 8]
      .map((i) =>
        [terrains[i], terrains[i + 1]]
          .map((t) => `<td class="icon">${img(terrainUrl(t, 0, 0))}</td><th>${TERRAIN[t].name}</th><td class="num">${TERRAIN[t].moveCost}</td><td>${TERRAIN[t].summary}</td>`)
          .join(''),
      )
      .map((row) => `<tr>${row}</tr>`)
      .join('')}
  </table>
  <p class="tiny">同じマスで採取を続けると採り尽くされて出にくくなる（時間で戻る）。海には入れない。洞窟・難破船・遺跡は「特殊マス」で、最初の採取はレアが確定。</p>

  <h2 class="pixel">クラフト（主なもの。ほかはゲーム内の一覧で）</h2>
  <table>
    <tr><th class="icon"></th><th>名前</th><th>AP</th><th>素材</th><th>効果</th><th class="icon"></th><th>名前</th><th>AP</th><th>素材</th><th>効果</th></tr>
    ${Array.from({ length: recipes.length / 2 }, (_, i) =>
      [recipes[i * 2], recipes[i * 2 + 1]]
        .map((id) => {
          const r = RECIPES[id];
          const icon = r.builds ? structureUrl(r.builds) : itemUrl(r.output!.item);
          return `<td class="icon">${img(icon)}</td><th>${r.name}</th><td class="num">${r.ap}</td><td>${inputs(id)}</td><td>${r.summary}</td>`;
        })
        .join(''),
    )
      .map((row) => `<tr>${row}</tr>`)
      .join('')}
  </table>

  <h2 class="pixel">戦闘（マス目で見る届く範囲）</h2>
  <div class="reach">
    ${reachGrid('素手・ナイフ・石斧', '同じマスだけ。隣の相手には、そのマスへ入ってから殴る（移動コスト＋攻撃1AP）', (dx, dy) => (dx === 0 && dy === 0 ? 'hit' : Math.abs(dx) + Math.abs(dy) === 1 ? 'walk' : ''))}
    ${reachGrid('槍', `隣の8マスまで動かずに届く。斜めは命中率${Math.round(COMBAT.diagonalHit * 100)}%・ダメージ${COMBAT.diagonalDamage}`, (dx, dy) => (Math.max(Math.abs(dx), Math.abs(dy)) <= 1 ? (dx !== 0 && dy !== 0 ? 'diag' : 'hit') : ''))}
    ${reachGrid('弓（昼だけ）', `2マス先まで。森にいる相手は命中率${Math.round(COMBAT.rangedIntoForest * 100)}%`, (dx, dy) => (Math.max(Math.abs(dx), Math.abs(dy)) <= 2 ? (dx !== 0 && dy !== 0 ? 'diag' : 'hit') : ''))}
    ${reachGrid('石を投げる（昼だけ）', '2マス先まで。縦・横・斜めのまっすぐな線の上だけ', (dx, dy) => (Math.max(Math.abs(dx), Math.abs(dy)) <= 2 && (dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)) ? (dx !== 0 && dy !== 0 ? 'diag' : 'hit') : ''))}
  </div>
  <p class="tiny"><span class="key me">自</span>あなた<span class="key hit"></span>届く<span class="key diag"></span>斜め（命中率−15%・ダメージ−1）<span class="key walk"></span>そのマスへ入れば殴れる</p>
  <div class="cols">
    <ul>
      <li><b>相手が動いたら</b>：実行のとき相手が先に動いて離れても、残りのAPで届くなら<b>追いかけて</b>攻撃する。届かなければ不発でAP−1。攻撃は1ターンに1回</li>
      <li><b>奪う・反撃</b>：命中すると相手の持ち物を1つ奪う（隣のマスまで）。同じマスで殴ると${Math.round(COMBAT.counterChance * 100)}%で反撃される</li>
      <li>最初の${EARLY_PROTECTION_TURNS / 2}日間は、プレイヤーを攻撃できない。夜は人影しか見えず、殴る攻撃も当たりにくい</li>
    </ul>
    <ul>
      <li>岩場にいる人は守りが固く（ダメージ−${COMBAT.rockDefense}）、砦の中は防御+2。防御中の相手は当たりにくい</li>
      <li>罠：そのマスに入った他人にHP−2＋足止め。瓶で殴ると1回で割れる。脱落した人の持ち物は「遺品」として残る</li>
    </ul>
  </div>
  <p class="foot">2 / 5</p>
</section>`;

const page3 = `
<section class="page">
  <h2 class="pixel">職業と特殊勝利</h2>
  <table>
    <tr><th class="icon"></th><th>職業</th><th>機敏さ</th><th>特技</th><th>特殊勝利の条件</th></tr>
    ${JOB_IDS.map(
      (id, i) =>
        `<tr><td class="icon">${img(personUrl(id, i % 5))}</td><th>${JOBS[id].name}</th><td class="num">${JOBS[id].agility}</td><td>${JOBS[id].passive}</td><td>${JOBS[id].goal}</td></tr>`,
    ).join('')}
  </table>

  <h2 class="pixel">特性</h2>
  <div class="cols traits">
    <div>
      <p class="tiny">レア度の下は使い方：ずっと＝いつでも効く、1回だけ／1日1回＝回数に限りあり、ボタン＝自分で使う（ほかは自動）、公開＝効くと全員に明かされる</p>
      <h3>公開特性（全員に見える）</h3>
      <table>${traitRows(false)}</table>
    </div>
    <div>
      <h3>秘密特性（自分だけ。発動すると明かされるものも）</h3>
      <table>${traitRows(true)}</table>
    </div>
  </div>

  <h2 class="pixel">島で起きること</h2>
  <div class="cols">
    <ul>
      <li><b>天気</b>：毎朝変わる。晴れは喉が渇き、雨は水分が増えるが視界が狭く狼煙を上げられない。嵐は小屋の外でHP−${WEATHER.stormDamage}・移動コスト+${WEATHER.stormMoveCost}</li>
      <li><b>動物</b>：小動物（狩ると肉）、猿（食料を盗む）、大イノシシ（突進してくる）、群れ、浜に打ち上げられた漂流者</li>
      <li><b>潮位上昇</b>：${WEATHER.tideStartDay}日目から砂浜が1日1か所ずつ沈む。前の日に地図で予告される</li>
    </ul>
    <ul>
      <li><b>最終局面（${dayOf(FINAL.startTurn)}日目〜）</b>：霧が晴れて島全体が見え、${FINAL.sinkEveryTurns}ターンごとに外側から沈む。特殊勝利はなくなり、攻撃が強くなる（ダメージ+${FINAL.attackBonus}）。沈んだマスに残ると脱落</li>
      <li><b>幽霊</b>：脱落しても終わりではない。1日1回、濃霧・物音・動物を誘う・守護のどれかを起こせる。自分を倒した相手に1回だけ祟れる</li>
    </ul>
  </div>

  <p class="foot">3 / 5</p>
</section>`;

/** 4ページ目：どこで何が採れるか。数字は採取テーブルから計算する */
const pct = (n: number) => `${Math.round(n * 100)}%`;
const rollText = (rolls: ItemRoll[]) =>
  rolls.map((r) => `${ITEMS[r.item].name}${r.max > 1 ? `×${r.min === r.max ? r.min : `${r.min}〜${r.max}`}` : ''}`).join('／');

function gatherCell(terrain: TerrainId): string {
  const entries = TERRAIN[terrain].gather;
  const total = entries.reduce((n, e) => n + e.weight, 0);
  return entries
    .map((e) => {
      const p = pct(e.weight / total);
      if (e.kind === 'nothing') return `<span class="miss">何もなし ${p}</span>`;
      if (e.kind === 'nest') return `小動物の巣 ${p}（次の狩りの命中+${Math.round(NEST_HIT_BONUS * 100)}%）`;
      if (e.kind === 'danger') return `<span class="miss">野生動物に襲われる ${p}（HP−${e.damage}）</span>`;
      const pick = e.rolls.length > 1 ? '（どれか1つ）' : '';
      const need = e.requiresAnyOf ? '（<b>釣り道具が必要</b>）' : '';
      return `${rollText(e.rolls)} ${p}${pick}${need}`;
    })
    .join('、');
}

/** 素材から採れる場所を引く */
function whereToFind(): { item: ItemId; where: string[] }[] {
  const found = new Map<ItemId, string[]>();
  const note = (item: ItemId, text: string) => {
    const list = found.get(item) ?? [];
    if (!list.includes(text)) list.push(text);
    found.set(item, list);
  };
  for (const t of ['beach', 'grass', 'forest', 'rock', 'mountain'] as TerrainId[]) {
    for (const e of TERRAIN[t].gather) if (e.kind === 'item') for (const r of e.rolls) note(r.item, TERRAIN[t].name);
  }
  note('water', '泉・川（水筒があれば持ち運べる）');
  note('fish', `川（釣り道具があれば${pct(RIVER_FISH_CHANCE)}）`);
  for (const t of SPECIAL_TERRAINS) for (const r of SPECIAL_LOOT[t]) note(r.item, `${TERRAIN[t].name}（最初の1回）`);
  note('meat', `狩り（小動物${NPC_MEAT.critter}・群れ${NPC_MEAT.herd}・大イノシシ${NPC_MEAT.boar}。刃物があれば+1）`);
  note('island_lord', `漁師が魚を釣り続けると（${GOALS.lordCeiling}匹で必ず）`);
  for (const id of Object.keys(RECIPES) as RecipeId[]) {
    const out = RECIPES[id].output;
    if (out && !RECIPES[id].course) note(out.item, 'クラフトで作る');
  }
  for (const s of SUPPLY_ITEMS) note(s.item, '支援物資');
  for (const s of CASTAWAY_REWARDS) note(s.item, '漂流者のお礼');
  for (const job of JOB_IDS) for (const s of JOBS[job].items) note(s.item, '初期所持品');
  note('shell_husk', '貝を食べると残る');
  return (Object.keys(ITEMS) as ItemId[])
    .filter((item) => item !== 'full_course')
    .map((item) => ({ item, where: found.get(item) ?? [] }));
}

const terrainRows = (['beach', 'grass', 'forest', 'rock', 'mountain'] as TerrainId[])
  .map((t) => `<tr><td class="icon">${img(terrainUrl(t, 0, 0))}</td><th>${TERRAIN[t].name}</th><td>${gatherCell(t)}</td></tr>`)
  .join('');
const waterRows = (['spring', 'river'] as TerrainId[])
  .map(
    (t) =>
      `<tr><td class="icon">${img(terrainUrl(t, 0, 0))}</td><th>${TERRAIN[t].name}</th><td>必ず水が飲める（水分+${DRINK_AT_SOURCE}）。水筒があれば淡水1つを持ち帰る${t === 'river' ? `。釣り道具があれば${pct(RIVER_FISH_CHANCE)}で魚も` : ''}。採り尽くされない</td></tr>`,
  )
  .join('');
const specialRows = SPECIAL_TERRAINS.map(
  (t) =>
    `<tr><td class="icon">${img(terrainUrl(t, 0, 0))}</td><th>${TERRAIN[t].name}</th><td>最初の1回はレア確定：${rollText(SPECIAL_LOOT[t])}のどれか。2回目からは${pct(SPECIAL_REPEAT_NOTHING_CHANCE)}で何もなし</td></tr>`,
).join('');
/** 持っているだけで効く道具 */
const TOOL_USES: Partial<Record<ItemId, string>> = {
  compass: '持っていると方向音痴で迷わない',
  map_fragment: 'ゲーム開始時に5×5マスの霧が晴れる',
  binoculars: '昼の視界+1',
  pot: '食料を食べたときの回復+1',
  salt: '魚・肉・干し魚・卵の回復+1',
  backpack: '所持枠+4',
  torch: '夜の視界+1（ただし夜でも自分が誰か見える）',
  fishing_line: '砂浜・川で魚が釣れる',
  fishing_rod: '砂浜・川で魚が釣れる（1匹多い）',
  canteen: '泉・川の水を淡水として持ち運べる',
  stone_axe: '木材の採取が2倍',
  island_lord: '漁師の勝利条件。料理人の食材2ジャンル分',
};

/** その素材の使い道。食べる・材料・武器・道具をまとめる */
function itemUses(item: ItemId): string[] {
  const uses: string[] = [];
  const effect = ITEMS[item].use;
  if (effect) {
    const gains = [
      effect.hunger ? `満腹+${effect.hunger}` : '',
      effect.water ? `水分+${effect.water}` : '',
      effect.hp ? `HP+${effect.hp}` : '',
      effect.stopsBleeding ? '出血を止める' : '',
      effect.curesPoison ? '中毒を治す' : '',
      effect.risky ? '中毒のおそれ' : '',
      effect.winsGame ? '食べると勝利' : '',
    ].filter(Boolean);
    uses.push(`${effect.food ? '食べる' : effect.water ? '飲む' : '使う'}（${gains.join('・')}）`);
  }
  const genre = ITEM_GENRE[item];
  if (genre && item !== 'island_lord') uses.push(`料理人の食材（${GENRE_NAMES[genre]}）`);
  const tool = TOOL_USES[item];
  if (tool) uses.push(tool);
  if (WEAPONS[item]) uses.push('武器');
  if (item === THROW_ITEM) uses.push('投げて攻撃');
  if (item === BOTTLE_ITEM) uses.push('殴ると割れる武器');
  const recipes = (Object.keys(RECIPES) as RecipeId[]).filter((id) => RECIPES[id].inputs.some((set) => set.some((n) => n.item === item)));
  if (recipes.length > 0) uses.push(`${recipes.map((id) => RECIPES[id].name).join('・')}の材料`);
  if (RAFT.needs.some((n) => n.item === item)) uses.push('いかだの材料');
  if (item === LETTER.material) uses.push('手紙');
  return uses;
}

const findRows = whereToFind();
const findTable = (rows: typeof findRows) =>
  `<table><tr><th class="icon"></th><th>アイテム</th><th>手に入る場所</th><th>使い道</th></tr>${rows
    .map(({ item, where }) => {
      const uses = itemUses(item);
      return `<tr><td class="icon">${img(itemUrl(item))}</td><th>${ITEMS[item].name}</th><td>${where.join('、') || '—'}</td><td>${uses.join('、') || '<span class="miss">今は使い道なし</span>'}</td></tr>`;
    })
    .join('')}</table>`;

const page4 = `
<section class="page">
  <h2 class="pixel">どこで何が採れるか（採取 AP${GATHER_AP}）</h2>
  <p>確率は昼・採り尽くしていないときの目安。地形ごとに、次のどれか1つが出る。</p>
  <table class="gather">
    <tr><th class="icon"></th><th>地形</th><th>出るもの（確率）</th></tr>
    ${terrainRows}${waterRows}${specialRows}
  </table>

  <h3>出やすさが変わること</h3>
  <div class="cols">
    <ul>
      <li><b>夜</b>は何か見つかる確率が${pct(NIGHT_GATHER_PENALTY)}下がる</li>
      <li>同じマスで採るほど<b>採り尽くされ</b>、1段階ごとに−${pct(DEPLETION.penaltyPerLevel)}（最大${DEPLETION.max}段階）。${DEPLETION.recoverEveryTurns}ターンごとに1段階戻る</li>
      <li>「何もなし」が${PITY_AFTER_DRY_STREAK}回続くと、次は必ず何か見つかる</li>
      <li>最終局面では採取の成功率が半分になる</li>
    </ul>
    <ul>
      <li><b>石斧</b>で木材が2倍、<b>釣竿</b>なら魚が1匹多い。漁師は砂浜で魚が${FISHER_FISH_MULTIPLIER}倍出やすい</li>
      <li>強運は「何もなし」を引き直す。方向音痴は+${LOST_SENSE_GATHER}%、漂流者の知恵は砂浜で布とロープ片が出やすい</li>
      <li>助けた漂流者が一緒にいると+${FOLLOWER_GATHER}%、幽霊の「守護」を受けたマスも出やすい</li>
    </ul>
  </div>

  <h2 class="pixel">はじめて遊ぶ人へのコツ</h2>
  <div class="box">
    <p>① まずは水場（泉・川）の場所を覚える。② 序盤の2日間は攻撃されないので、採取と探索で準備する。③ 行動順が後の人は、先に動く人の動きを読んで予約する。④ 密談で手を組むのも、裏切るのも自由。⑤ 「誰かが勝利目前！」と賞金首が出たら、全員で止めに行こう。</p>
  </div>
  <p class="foot">4 / 5</p>
</section>`;

const page5 = `
<section class="page">
  <h2 class="pixel">素材の逆引き（どこで手に入り、何に使うか）</h2>
  <div class="find">
    ${findTable(findRows)}
  </div>
  <p class="foot">5 / 5</p>
</section>`;

document.getElementById('book')!.innerHTML = page1 + page2 + page3 + page4 + page5;
