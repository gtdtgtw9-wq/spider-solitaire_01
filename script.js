(function(){
"use strict";

/* ---------- Models ---------- */
const SUITS = {
  spades:  {symbol:"♠", red:false},
  hearts:  {symbol:"♥", red:true},
  diamonds:{symbol:"♦", red:true},
  clubs:   {symbol:"♣", red:false}
};
const DIFF_TITLES = { oneSuit:"1スート", twoSuits:"2スート", fourSuits:"4スート" };

let uidCounter = 1;
function makeCard(rank, suit, faceUp){
  return { id: "c"+(uidCounter++), rank, suit, isFaceUp: !!faceUp };
}
function rankLabel(rank){
  if(rank===1) return "A";
  if(rank===11) return "J";
  if(rank===12) return "Q";
  if(rank===13) return "K";
  return String(rank);
}

/* ---------- Local storage ---------- */
const LS_GAME = "spider_solitaire_game_v1";
const LS_STATS = "spider_solitaire_stats_v1";

function loadStatistics(){
  try{
    const raw = localStorage.getItem(LS_STATS);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return { gamesStarted:0, gamesWon:0, bestScore:0, bestTime:null, fewestMoves:null };
}
function saveStatistics(stats){
  try{ localStorage.setItem(LS_STATS, JSON.stringify(stats)); }catch(e){}
}
function loadGame(){
  try{
    const raw = localStorage.getItem(LS_GAME);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return null;
}
function saveGame(snapshot){
  try{ localStorage.setItem(LS_GAME, JSON.stringify(snapshot)); }catch(e){}
}

/* ---------- Engine ---------- */
const Engine = {
  buildDeck(difficulty){
    let pattern;
    if(difficulty === "oneSuit"){
      pattern = Array(8).fill("spades");
    } else if(difficulty === "twoSuits"){
      pattern = ["spades","hearts","spades","hearts","spades","hearts","spades","hearts"];
    } else {
      pattern = ["spades","hearts","diamonds","clubs","spades","hearts","diamonds","clubs"];
    }
    const deck = [];
    for(const suit of pattern){
      for(let rank=1; rank<=13; rank++){
        deck.push(makeCard(rank, suit, false));
      }
    }
    return deck;
  },
  shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [a[i],a[j]] = [a[j],a[i]];
    }
    return a;
  },
  newGame(difficulty){
    let deck = Engine.shuffle(Engine.buildDeck(difficulty));
    const tableau = [];
    for(let col=0; col<10; col++){
      const count = col < 4 ? 6 : 5;
      const cards = deck.slice(0, count);
      deck = deck.slice(count);
      if(cards.length){ cards[cards.length-1].isFaceUp = true; }
      tableau.push(cards);
    }
    const stock = [];
    for(let start=0; start<deck.length; start+=10){
      stock.push(deck.slice(start, Math.min(start+10, deck.length)));
    }
    return {
      tableau, stock,
      completedRuns:0,
      score:500,
      moves:0,
      selectedCardID:null,
      difficulty,
      elapsedSeconds:0,
      hasWon:false
    };
  },
  findSelection(snapshot){
    if(!snapshot.selectedCardID) return null;
    for(let c=0;c<snapshot.tableau.length;c++){
      const idx = snapshot.tableau[c].findIndex(card=>card.id===snapshot.selectedCardID);
      if(idx !== -1) return { column:c, startIndex:idx };
    }
    return null;
  },
  isMovableSequence(column, startIndex){
    if(startIndex >= column.length) return false;
    if(!column[startIndex].isFaceUp) return false;
    if(column.length === 0) return false;
    if(startIndex === column.length-1) return true;
    for(let i=startIndex; i<column.length-1; i++){
      const upper = column[i], lower = column[i+1];
      if(!upper.isFaceUp || !lower.isFaceUp) return false;
      if(upper.rank !== lower.rank+1) return false;
    }
    return true;
  },
  movableSequenceStart(column, cardID){
    const idx = column.findIndex(c=>c.id===cardID);
    if(idx === -1) return null;
    return Engine.isMovableSequence(column, idx) ? idx : null;
  },
  canPlace(sequence, target){
    if(!sequence.length) return false;
    if(!target) return true;
    return target.isFaceUp && target.rank === sequence[0].rank + 1;
  },
  revealTopCard(column){
    if(column.length){ column[column.length-1].isFaceUp = true; }
  },
  hasCompletedRun(column){
    if(column.length < 13) return false;
    const slice = column.slice(column.length-13);
    const suit = slice[0].suit;
    for(let offset=0; offset<13; offset++){
      const expected = 13-offset;
      const card = slice[offset];
      if(!card.isFaceUp) return false;
      if(card.suit !== suit) return false;
      if(card.rank !== expected) return false;
    }
    return true;
  },
  removeCompletedRuns(snapshot){
    for(let c=0;c<snapshot.tableau.length;c++){
      while(Engine.hasCompletedRun(snapshot.tableau[c])){
        snapshot.tableau[c] = snapshot.tableau[c].slice(0, snapshot.tableau[c].length-13);
        snapshot.completedRuns += 1;
        snapshot.score += 100;
        Engine.revealTopCard(snapshot.tableau[c]);
      }
    }
    snapshot.hasWon = snapshot.completedRuns === 8;
  },
  move(snapshot, source, targetColumn){
    if(source.column === targetColumn){
      const unchanged = structuredClone(snapshot);
      unchanged.selectedCardID = null;
      return unchanged;
    }
    if(source.column<0 || source.column>=snapshot.tableau.length) throw new Error("invalidSelection");
    if(targetColumn<0 || targetColumn>=snapshot.tableau.length) throw new Error("invalidTarget");
    if(!Engine.isMovableSequence(snapshot.tableau[source.column], source.startIndex)) throw new Error("invalidSelection");

    const next = structuredClone(snapshot);
    const moving = next.tableau[source.column].slice(source.startIndex);
    const targetCol = next.tableau[targetColumn];
    const targetTop = targetCol.length ? targetCol[targetCol.length-1] : null;
    if(!Engine.canPlace(moving, targetTop)) throw new Error("invalidTarget");

    next.tableau[source.column] = next.tableau[source.column].slice(0, source.startIndex);
    Engine.revealTopCard(next.tableau[source.column]);
    next.tableau[targetColumn] = targetCol.concat(moving);
    next.moves += 1;
    next.score = Math.max(0, next.score-1);
    next.selectedCardID = null;

    Engine.removeCompletedRuns(next);
    return next;
  },
  dealFromStock(snapshot){
    if(!snapshot.stock.length) throw new Error("emptyStock");

    const next = structuredClone(snapshot);
    const pile = next.stock.shift();
    for(let c=0;c<next.tableau.length;c++){
      const card = structuredClone(pile[c]);
      card.isFaceUp = true;
      next.tableau[c].push(card);
    }
    next.moves += 1;
    next.score = Math.max(0, next.score-1);
    next.selectedCardID = null;
    Engine.removeCompletedRuns(next);
    return next;
  },
  hint(snapshot){
    for(let sc=0; sc<snapshot.tableau.length; sc++){
      const cards = snapshot.tableau[sc];
      for(let start=0; start<cards.length; start++){
        if(!Engine.isMovableSequence(cards, start)) continue;
        const moving = cards.slice(start);
        for(let tc=0; tc<snapshot.tableau.length; tc++){
          if(tc===sc) continue;
          const target = snapshot.tableau[tc];
          const top = target.length ? target[target.length-1] : null;
          if(Engine.canPlace(moving, top)){
            return { fromColumn:sc, toColumn:tc, movingCard:cards[start] };
          }
        }
      }
    }
    return null;
  }
};

/* ---------- App state ---------- */
let snapshot;
let statistics = loadStatistics();
let history = [];
let bannerTimeout = null;
let timerHandle = null;
let CARD_W = 56;
let CARD_H = 75;

function formattedTime(seconds){
  const m = Math.floor(seconds/60);
  const s = seconds%60;
  return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}

function computeCardMetrics(){
  const wrap = document.querySelector(".board-wrap");
  if(!wrap) return;
  const stylePad = 20; // matches .board-wrap horizontal padding (10px each side)
  const availW = Math.max(240, wrap.clientWidth - stylePad);
  const availH = Math.max(200, wrap.clientHeight - 8); // matches bottom padding

  const cols = 5, rows = 2;
  const gap = Math.max(3, Math.min(10, Math.round(availW/160)));

  const cellW = (availW - gap*(cols-1)) / cols;
  const cellH = (availH - gap*(rows-1)) / rows;

  let cardWidth = Math.floor(cellW);
  let cardHeight = Math.round(cardWidth * (96/72));

  // 縦方向: カード束の展開分(gapForの budget=2.6*CARD_H + カード本体分)が
  // 行の高さに収まるよう、必要なら高さ基準で幅を再計算する
  const maxCardHeightForStack = (cellH - 6) / 3.6;
  if(cardHeight > maxCardHeightForStack){
    cardHeight = Math.floor(maxCardHeightForStack);
    cardWidth = Math.round(cardHeight * (72/96));
  }

  cardWidth = Math.max(30, Math.min(150, cardWidth));
  cardHeight = Math.max(40, Math.min(200, cardHeight));

  CARD_W = cardWidth;
  CARD_H = cardHeight;

  const root = document.documentElement.style;
  root.setProperty("--card-w", cardWidth+"px");
  root.setProperty("--card-h", cardHeight+"px");
  root.setProperty("--col-gap", gap+"px");
}

let resizeRAF = null;
function onViewportResize(){
  if(resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(()=>{
    computeCardMetrics();
    if(snapshot) render();
  });
}

function init(){
  const saved = loadGame();
  if(saved){
    snapshot = saved;
  } else {
    snapshot = Engine.newGame("oneSuit");
    statistics.gamesStarted += 1;
    saveStatistics(statistics);
    saveGame(snapshot);
  }
  loadCardBgByRank();
  loadBoardBackground();
  computeCardMetrics();
  render();
  startTimer();
  bindEvents();
  buildRankBgList();
  window.addEventListener("resize", onViewportResize);
  window.addEventListener("orientationchange", onViewportResize);
}

function persist(){
  saveGame(snapshot);
  saveStatistics(statistics);
}

function showBanner(msg){
  const b = document.getElementById("banner");
  if(!msg){
    b.classList.remove("show");
    return;
  }
  b.textContent = msg;
  b.classList.add("show");
  if(bannerTimeout) clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(()=>{ b.classList.remove("show"); }, 2600);
}

function pushHistory(){
  history.push(structuredClone(snapshot));
  if(history.length > 100) history.shift();
}

function handleWinTransition(previousWinState){
  if(!snapshot.hasWon || previousWinState) return;
  statistics.gamesWon += 1;
  statistics.bestScore = Math.max(statistics.bestScore, snapshot.score);
  statistics.bestTime = (statistics.bestTime==null) ? snapshot.elapsedSeconds : Math.min(statistics.bestTime, snapshot.elapsedSeconds);
  statistics.fewestMoves = (statistics.fewestMoves==null) ? snapshot.moves : Math.min(statistics.fewestMoves, snapshot.moves);
  persist();
  openWinSheet();
}

function attemptMove(source, targetColumn){
  try{
    pushHistory();
    const wasWon = snapshot.hasWon;
    snapshot = Engine.move(snapshot, source, targetColumn);
    handleWinTransition(wasWon);
    showBanner("");
    persist();
  }catch(e){
    history.pop();
    const msg = {
      invalidSelection: "その位置からは移動できません",
      invalidTarget: "そこには置けません"
    }[e.message] || "移動できません";
    showBanner(msg);
  }
  render();
}

function selectOrMove(card, columnIndex){
  if(snapshot.selectedCardID === card.id){
    snapshot.selectedCardID = null;
    showBanner("");
    persist();
    render();
    return;
  }
  const selected = Engine.findSelection(snapshot);
  if(selected){
    attemptMove(selected, columnIndex);
    return;
  }
  const startIndex = Engine.movableSequenceStart(snapshot.tableau[columnIndex], card.id);
  if(startIndex !== null){
    snapshot.selectedCardID = snapshot.tableau[columnIndex][startIndex].id;
    showBanner("移動先の列をタップしてください");
  } else {
    showBanner("その位置からは移動できません");
  }
  persist();
  render();
}

function tapEmptyColumn(columnIndex){
  const selected = Engine.findSelection(snapshot);
  if(!selected) return;
  attemptMove(selected, columnIndex);
}

function dealFromStock(){
  try{
    pushHistory();
    const wasWon = snapshot.hasWon;
    snapshot = Engine.dealFromStock(snapshot);
    handleWinTransition(wasWon);
    showBanner("山札を配りました");
    persist();
  }catch(e){
    history.pop();
    const msg = {
      emptyStock: "山札がありません"
    }[e.message] || "山札を配れません";
    showBanner(msg);
  }
  render();
}

function undo(){
  if(!history.length){
    showBanner("これ以上戻せません");
    render();
    return;
  }
  snapshot = history.pop();
  closeOverlay(document.getElementById("overlayWin"));
  showBanner("1手戻しました");
  persist();
  render();
}

function showHint(){
  const h = Engine.hint(snapshot);
  if(h){
    showBanner("ヒント: 列"+(h.fromColumn+1)+"の"+rankLabel(h.movingCard.rank)+SUITS[h.movingCard.suit].symbol+"を列"+(h.toColumn+1)+"へ");
  } else if(snapshot.stock.length && snapshot.tableau.every(c=>c.length>0)){
    showBanner("動きが少ないです。山札を配ると展開できるかもしれません");
  } else {
    showBanner("有効なヒントが見つかりません");
  }
  render();
}

function startNewGame(difficulty){
  history = [];
  snapshot = Engine.newGame(difficulty);
  statistics.gamesStarted += 1;
  showBanner(DIFF_TITLES[difficulty]+"で新しいゲームを開始しました");
  persist();
  render();
}

function startTimer(){
  if(timerHandle) clearInterval(timerHandle);
  timerHandle = setInterval(()=>{
    if(snapshot.hasWon) return;
    snapshot.elapsedSeconds += 1;
    document.getElementById("statTime").textContent = formattedTime(snapshot.elapsedSeconds);
    if(snapshot.elapsedSeconds % 10 === 0) persist();
  }, 1000);
}

/* ---------- Rendering ---------- */
function render(){
  document.getElementById("statDifficulty").textContent = DIFF_TITLES[snapshot.difficulty];
  document.getElementById("btnDifficulty").textContent = DIFF_TITLES[snapshot.difficulty];
  document.getElementById("statCompleted").textContent = snapshot.completedRuns+"/8";
  document.getElementById("statScore").textContent = snapshot.score;
  document.getElementById("statTime").textContent = formattedTime(snapshot.elapsedSeconds);

  const undoBtn = document.getElementById("btnUndo");
  undoBtn.classList.toggle("disabled", history.length===0);
  const dealBtn = document.getElementById("btnDeal");
  dealBtn.classList.toggle("disabled", snapshot.stock.length===0);

  const board = document.getElementById("board");
  board.innerHTML = "";
  snapshot.tableau.forEach((cards, colIndex)=>{
    const col = document.createElement("div");
    col.className = "column";
    col.dataset.col = String(colIndex);

    const slot = document.createElement("div");
    slot.className = "column-slot";
    slot.addEventListener("click", ()=>{ if(cards.length===0) tapEmptyColumn(colIndex); });
    col.appendChild(slot);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "column-cards";

    let hiddenCount = 0;
    while(hiddenCount < cards.length && !cards[hiddenCount].isFaceUp) hiddenCount++;
    const visualCount = (hiddenCount>0 ? 1 : 0) + (cards.length - hiddenCount);
    const visibleGap = gapFor(visualCount);

    let visSlot = 0;
    if(hiddenCount > 0){
      const boxEl = buildHiddenStackEl(hiddenCount);
      boxEl.style.top = (6 + visSlot*visibleGap) + "px";
      boxEl.style.zIndex = visSlot;
      cardsWrap.appendChild(boxEl);
      visSlot++;
    }
    for(let i=hiddenCount; i<cards.length; i++){
      const card = cards[i];
      const el = buildCardEl(card, snapshot.selectedCardID===card.id);
      el.style.top = (6 + visSlot*visibleGap) + "px";
      el.style.zIndex = visSlot;
      el.dataset.cardId = card.id;
      el.addEventListener("pointerdown", (ev)=>{
        onCardPointerDown(ev, card, colIndex, el);
      });
      cardsWrap.appendChild(el);
      visSlot++;
    }

    col.appendChild(cardsWrap);
    board.appendChild(col);
  });
}

function buildHiddenStackEl(count){
  const el = document.createElement("div");
  el.className = "card face-down hidden-stack";
  el.innerHTML =
    '<div class="card-back-pattern"><span>♠</span></div>' +
    '<div class="hidden-stack-badge">'+count+'</div>';
  return el;
}

function buildCardEl(card, isSelected){
  const el = document.createElement("div");
  const suitInfo = SUITS[card.suit];
  const rankBg = card.isFaceUp ? getRankBg(card.rank) : null;
  el.className = "card " + (card.isFaceUp ? "face-up" : "face-down") + (card.isFaceUp ? (suitInfo.red ? " red" : " black") : "") + (isSelected ? " selected" : "") + (rankBg ? " has-bg" : "");
  if(rankBg){
    el.style.backgroundImage = "url(" + rankBg + ")";
  }
  if(card.isFaceUp){
    el.innerHTML =
      '<div class="corner"><span class="r">'+rankLabel(card.rank)+'</span><span class="s">'+suitInfo.symbol+'</span></div>' +
      '<div class="center">'+suitInfo.symbol+'</div>';
  } else {
    el.innerHTML = '<div class="card-back-pattern"><span>♠</span></div>';
  }
  return el;
}

/* ---------- Drag & drop ---------- */
const MOUSE_START_PX = 4;
const TOUCH_START_PX = 6;

let dragState = null;

function gapFor(count){
  const minGap = CARD_H * 0.167;
  const maxGap = CARD_H * 0.27;
  const budget = CARD_H * 2.6;
  return Math.max(minGap, Math.min(maxGap, budget/Math.max(count,1)));
}

function onCardPointerDown(ev, card, colIndex, el){
  if(ev.pointerType === "mouse" && ev.button !== 0) return;
  if(dragState) return;

  el.classList.add("card-press");

  dragState = {
    pointerId: ev.pointerId,
    pointerType: ev.pointerType,
    colIndex,
    card,
    el,
    startIndex: Engine.movableSequenceStart(snapshot.tableau[colIndex], card.id),
    startX: ev.clientX,
    startY: ev.clientY,
    dragging:false,
    ghostEl:null,
    sourceEls:[],
    grabOffsetX:0,
    grabOffsetY:0,
    rafScheduled:false,
    lastClientX:ev.clientX,
    lastClientY:ev.clientY
  };
}

function tryStartDrag(){
  if(!dragState) return;
  if(dragState.startIndex === null) return; // not a movable sequence, resolves as tap on release

  dragState.dragging = true;
  dragState.el.classList.remove("card-press");
  showBanner("");

  try{ dragState.el.setPointerCapture(dragState.pointerId); }catch(err){}

  const colCards = snapshot.tableau[dragState.colIndex];
  const movingCards = colCards.slice(dragState.startIndex);
  dragState.movingCards = movingCards;

  const rect = dragState.el.getBoundingClientRect();
  dragState.grabOffsetX = dragState.startX - rect.left;
  dragState.grabOffsetY = dragState.startY - rect.top;

  // hide originals for the moving sequence
  const cardsWrap = dragState.el.closest(".column-cards");
  const allCardEls = cardsWrap ? Array.from(cardsWrap.children) : [];
  let hiddenCount = 0;
  while(hiddenCount < colCards.length && !colCards[hiddenCount].isFaceUp) hiddenCount++;
  const domOffset = (hiddenCount>0 ? 1 : 0) + Math.max(0, dragState.startIndex - hiddenCount);
  dragState.sourceEls = allCardEls.slice(domOffset);
  dragState.sourceEls.forEach(e=>e.classList.add("drag-source-hidden"));

  // build ghost
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  const visualCount = (hiddenCount>0 ? 1 : 0) + (colCards.length - hiddenCount);
  const gap = gapFor(visualCount);
  movingCards.forEach((c, i)=>{
    const gEl = buildCardEl(c, false);
    gEl.style.top = (i*gap) + "px";
    gEl.style.zIndex = i;
    ghost.appendChild(gEl);
  });
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;

  positionGhost(dragState.lastClientX, dragState.lastClientY);
  updateDropHighlight(dragState.lastClientX, dragState.lastClientY);
}

function positionGhost(clientX, clientY){
  if(!dragState || !dragState.ghostEl) return;
  const x = clientX - dragState.grabOffsetX;
  const y = clientY - dragState.grabOffsetY;
  dragState.ghostEl.style.transform = "translate("+x+"px,"+y+"px)";
}

function findColumnElAtPoint(x, y){
  const cols = document.querySelectorAll(".column");
  let exact = null;
  let fallback = null, fallbackDist = Infinity;
  cols.forEach(col=>{
    const r = col.getBoundingClientRect();
    const xIn = x >= r.left && x <= r.right;
    const yIn = y >= r.top && y <= r.bottom;
    if(xIn && yIn){
      exact = col;
      return;
    }
    if(!exact){
      const dx = x < r.left ? (r.left-x) : (x > r.right ? (x-r.right) : 0);
      const dy = y < r.top ? (r.top-y) : (y > r.bottom ? (y-r.bottom) : 0);
      const dist = Math.hypot(dx, dy);
      if(dist < fallbackDist){ fallbackDist = dist; fallback = col; }
    }
  });
  const best = exact || fallback;
  const wrap = document.querySelector(".board-wrap");
  if(wrap){
    const wr = wrap.getBoundingClientRect();
    if(y < wr.top - 40 || y > wr.bottom + 120) return null;
  }
  return best;
}

function clearDropHighlights(){
  document.querySelectorAll(".column-slot.drop-ok, .column-slot.drop-bad").forEach(s=>{
    s.classList.remove("drop-ok","drop-bad");
  });
}

function updateDropHighlight(x, y){
  clearDropHighlights();
  if(!dragState) return;
  const colEl = findColumnElAtPoint(x, y);
  if(!colEl) return;
  const targetIndex = Number(colEl.dataset.col);
  if(targetIndex === dragState.colIndex) return;
  const slot = colEl.querySelector(".column-slot");
  if(!slot) return;
  const targetCol = snapshot.tableau[targetIndex];
  const top = targetCol.length ? targetCol[targetCol.length-1] : null;
  const ok = Engine.canPlace(dragState.movingCards, top);
  slot.classList.add(ok ? "drop-ok" : "drop-bad");
}

function cleanupDrag(){
  if(!dragState) return;
  if(dragState.el) dragState.el.classList.remove("card-press");
  if(dragState.ghostEl && dragState.ghostEl.parentNode) dragState.ghostEl.parentNode.removeChild(dragState.ghostEl);
  clearDropHighlights();
  dragState = null;
}

function scheduleDragFrame(){
  if(!dragState || dragState.rafScheduled) return;
  dragState.rafScheduled = true;
  requestAnimationFrame(()=>{
    if(!dragState) return;
    dragState.rafScheduled = false;
    positionGhost(dragState.lastClientX, dragState.lastClientY);
    updateDropHighlight(dragState.lastClientX, dragState.lastClientY);
  });
}

function onGlobalPointerMove(ev){
  if(!dragState || ev.pointerId !== dragState.pointerId) return;
  dragState.lastClientX = ev.clientX;
  dragState.lastClientY = ev.clientY;
  const dx = ev.clientX - dragState.startX;
  const dy = ev.clientY - dragState.startY;

  if(!dragState.dragging){
    const threshold = dragState.pointerType === "mouse" ? MOUSE_START_PX : TOUCH_START_PX;
    if(Math.hypot(dx, dy) > threshold){
      tryStartDrag();
    } else {
      return;
    }
  }

  if(dragState && dragState.dragging){
    ev.preventDefault();
    scheduleDragFrame();
  }
}

function onGlobalPointerUp(ev){
  if(!dragState || ev.pointerId !== dragState.pointerId) return;
  const wasDragging = dragState.dragging;
  const source = { column: dragState.colIndex, startIndex: dragState.startIndex };
  const card = dragState.card;
  const colIndex = dragState.colIndex;

  if(wasDragging){
    ev.preventDefault();
    const colEl = findColumnElAtPoint(ev.clientX, ev.clientY);
    cleanupDrag();
    if(colEl){
      const targetIndex = Number(colEl.dataset.col);
      attemptMove(source, targetIndex);
    } else {
      render();
    }
  } else {
    cleanupDrag();
    selectOrMove(card, colIndex);
  }
}

function onGlobalPointerCancel(ev){
  if(!dragState || ev.pointerId !== dragState.pointerId) return;
  cleanupDrag();
  render();
}

/* ---------- Overlays ---------- */
function openOverlay(el){ el.classList.add("show"); }
function closeOverlay(el){ el.classList.remove("show"); }

function openStatsSheet(){
  document.getElementById("stGamesStarted").textContent = statistics.gamesStarted;
  document.getElementById("stGamesWon").textContent = statistics.gamesWon;
  document.getElementById("stBestScore").textContent = statistics.bestScore;
  document.getElementById("stBestTime").textContent = statistics.bestTime!=null ? formattedTime(statistics.bestTime) : "-";
  document.getElementById("stFewestMoves").textContent = statistics.fewestMoves!=null ? statistics.fewestMoves : "-";
  openOverlay(document.getElementById("overlayStats"));
}
function openWinSheet(){
  document.getElementById("winMsg").textContent =
    "スコア: "+snapshot.score+"\n手数: "+snapshot.moves+"\n時間: "+formattedTime(snapshot.elapsedSeconds);
  openOverlay(document.getElementById("overlayWin"));
}

/* ---------- Card background image (per-rank) ---------- */
const CARD_BG_BY_RANK_KEY = "spiderSolitaireCardBgByRank";
let cardBgByRank = {};

function loadCardBgByRank(){
  cardBgByRank = {};
  try{
    const raw = localStorage.getItem(CARD_BG_BY_RANK_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === "object") cardBgByRank = parsed;
    }
  }catch(e){
    cardBgByRank = {};
  }
}

function saveCardBgByRank(){
  try{
    localStorage.setItem(CARD_BG_BY_RANK_KEY, JSON.stringify(cardBgByRank));
    return true;
  }catch(e){
    return false;
  }
}

function getRankBg(rank){
  return cardBgByRank[rank] || null;
}

function updateRankBgThumb(rank){
  const thumb = document.getElementById("rankBgThumb-"+rank);
  if(!thumb) return;
  const dataUrl = getRankBg(rank);
  if(dataUrl){
    thumb.style.backgroundImage = "url(" + dataUrl + ")";
  } else {
    thumb.style.backgroundImage = "";
  }
}

function handleRankBgFileSelect(rank, file){
  if(!file) return;
  compressImageFile(file, 768, 0.75).then((dataUrl)=>{
    cardBgByRank[rank] = dataUrl;
    if(!saveCardBgByRank()){
      showBanner("画像の保存に失敗しました(容量上限の可能性)。表示のみ反映されています");
    }
    updateRankBgThumb(rank);
    render();
  }).catch(()=>{
    showBanner("画像の読み込みに失敗しました");
  });
}

function resetRankBackground(rank){
  delete cardBgByRank[rank];
  saveCardBgByRank();
  updateRankBgThumb(rank);
  render();
  const input = document.getElementById("rankBgFile-"+rank);
  if(input) input.value = "";
}

function buildRankBgList(){
  const container = document.getElementById("rankBgList");
  if(!container) return;
  let html = "";
  for(let rank=1; rank<=13; rank++){
    html +=
      '<div class="rank-bg-row" data-rank="'+rank+'">' +
        '<div class="rank-bg-thumb" id="rankBgThumb-'+rank+'"></div>' +
        '<div class="rank-bg-row-main">' +
          '<div class="rank-bg-row-label">'+rankLabel(rank)+'</div>' +
          '<div class="rank-bg-row-btns">' +
            '<label class="rank-bg-upload-btn" for="rankBgFile-'+rank+'">アップロード</label>' +
            '<input type="file" accept="image/*" id="rankBgFile-'+rank+'" style="display:none;">' +
            '<button type="button" class="rank-bg-reset-btn">リセット</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }
  container.innerHTML = html;
  for(let rank=1; rank<=13; rank++){
    updateRankBgThumb(rank);
  }
}

/* ---------- Image compression (shared: board bg / per-rank card bg) ---------- */
function compressImageFile(file, maxWidth, quality){
  return new Promise((resolve, reject)=>{
    if(!file){ reject(new Error("no file")); return; }
    const reader = new FileReader();
    reader.onload = (e)=>{
      const img = new Image();
      img.onload = ()=>{
        let w = img.naturalWidth, h = img.naturalHeight;
        if(w > maxWidth){
          h = Math.round(h * (maxWidth / w));
          w = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        try{
          resolve(canvas.toDataURL("image/jpeg", quality));
        }catch(err){
          reject(err);
        }
      };
      img.onerror = ()=>reject(new Error("image load failed"));
      img.src = e.target.result;
    };
    reader.onerror = ()=>reject(new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

/* ---------- Board background image ---------- */
const BOARD_BG_STORAGE_KEY = "spiderSolitaireBoardBgImage";

function applyBoardBackground(dataUrl){
  if(dataUrl){
    document.documentElement.style.setProperty("--board-bg-image", "url(" + dataUrl + ")");
  } else {
    document.documentElement.style.removeProperty("--board-bg-image");
  }
}

function updateBoardBgPreview(dataUrl){
  const preview = document.getElementById("boardBgPreview");
  if(!preview) return;
  if(dataUrl){
    preview.style.backgroundImage = "url(" + dataUrl + ")";
    preview.textContent = "";
  } else {
    preview.style.backgroundImage = "";
    preview.textContent = "未設定(緑のフェルト背景のまま)";
  }
}

function loadBoardBackground(){
  let saved = null;
  try{ saved = localStorage.getItem(BOARD_BG_STORAGE_KEY); }catch(e){}
  if(saved){
    applyBoardBackground(saved);
  }
  updateBoardBgPreview(saved);
}

function handleBoardBgFileSelect(file){
  if(!file) return;
  compressImageFile(file, 768, 0.75).then((dataUrl)=>{
    applyBoardBackground(dataUrl);
    updateBoardBgPreview(dataUrl);
    try{
      localStorage.setItem(BOARD_BG_STORAGE_KEY, dataUrl);
    }catch(err){
      showBanner("画像の保存に失敗しました(サイズが大きすぎる可能性)。表示のみ反映されています");
    }
  }).catch(()=>{
    showBanner("画像の読み込みに失敗しました");
  });
}

function resetBoardBackground(){
  try{ localStorage.removeItem(BOARD_BG_STORAGE_KEY); }catch(e){}
  applyBoardBackground(null);
  updateBoardBgPreview(null);
  const input = document.getElementById("boardBgFileInput");
  if(input) input.value = "";
}

/* ---------- Background sheet tabs ---------- */
function switchBgTab(tab){
  document.getElementById("bgTabBtnCard").classList.toggle("active", tab === "card");
  document.getElementById("bgTabBtnBoard").classList.toggle("active", tab === "board");
  document.getElementById("bgTabCard").style.display = tab === "card" ? "" : "none";
  document.getElementById("bgTabBoard").style.display = tab === "board" ? "" : "none";
}

/* ---------- Events ---------- */
function bindEvents(){
  document.getElementById("btnNew").addEventListener("click", ()=>openOverlay(document.getElementById("overlayNewGame")));
  document.getElementById("btnDifficulty").addEventListener("click", ()=>openOverlay(document.getElementById("overlayNewGame")));
  document.getElementById("cancelNewGame").addEventListener("click", ()=>closeOverlay(document.getElementById("overlayNewGame")));
  document.getElementById("overlayNewGame").addEventListener("click", (e)=>{
    if(e.target.id==="overlayNewGame") closeOverlay(e.target);
  });
  document.querySelectorAll("#overlayNewGame .sheet-option").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      startNewGame(btn.dataset.diff);
      closeOverlay(document.getElementById("overlayNewGame"));
    });
  });

  document.getElementById("btnBg").addEventListener("click", ()=>openOverlay(document.getElementById("overlayBg")));
  document.getElementById("closeBg").addEventListener("click", ()=>closeOverlay(document.getElementById("overlayBg")));
  document.getElementById("overlayBg").addEventListener("click", (e)=>{
    if(e.target.id==="overlayBg") closeOverlay(e.target);
  });
  document.querySelectorAll(".bg-tab-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>switchBgTab(btn.dataset.tab));
  });
  document.getElementById("rankBgList").addEventListener("change", (e)=>{
    const input = e.target.closest("input[type=file]");
    if(!input) return;
    const row = input.closest(".rank-bg-row");
    const rank = Number(row.dataset.rank);
    handleRankBgFileSelect(rank, input.files && input.files[0]);
  });
  document.getElementById("rankBgList").addEventListener("click", (e)=>{
    const btn = e.target.closest(".rank-bg-reset-btn");
    if(!btn) return;
    const row = btn.closest(".rank-bg-row");
    const rank = Number(row.dataset.rank);
    resetRankBackground(rank);
  });
  document.getElementById("boardBgFileInput").addEventListener("change", (e)=>{
    handleBoardBgFileSelect(e.target.files && e.target.files[0]);
  });
  document.getElementById("btnBoardBgReset").addEventListener("click", resetBoardBackground);

  document.getElementById("btnStats").addEventListener("click", openStatsSheet);
  document.getElementById("closeStats").addEventListener("click", ()=>closeOverlay(document.getElementById("overlayStats")));
  document.getElementById("overlayStats").addEventListener("click", (e)=>{
    if(e.target.id==="overlayStats") closeOverlay(e.target);
  });

  document.getElementById("closeWin").addEventListener("click", ()=>closeOverlay(document.getElementById("overlayWin")));

  document.getElementById("btnDeal").addEventListener("click", dealFromStock);
  document.getElementById("btnUndo").addEventListener("click", undo);
  document.getElementById("btnHint").addEventListener("click", showHint);

  document.addEventListener("pointermove", onGlobalPointerMove, {passive:false});
  document.addEventListener("pointerup", onGlobalPointerUp, {passive:false});
  document.addEventListener("pointercancel", onGlobalPointerCancel, {passive:false});
}

init();
})();
