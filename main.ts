// main.ts — Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
// Reads /input/<id>/level.txt, writes LURD moves to /output/<id>/solution.txt.
// Push-optimal A* over box configurations, solved room by room: a generated
// level is a hallway with rooms off it, and a box pushed out of its room can
// never come back, so rooms are independent and the level's push optimum is
// the sum of its rooms'. A state is the boxes plus the player's reachable
// region (named by its lowest square); the heuristic is the sum of per-box
// push distances to the nearest goal (reverse BFS ignoring other boxes),
// admissible and consistent, so the first solved state popped is optimal.
// Prunings: dead squares and frozen 2x2 blocks. No clock, no randomness:
// the budget is a count of states, so two runs write identical bytes.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
// Directions, in this fixed order everywhere: up, down, left, right.
const DX = [0, 0, -1, 1];
const DY = [-1, 1, 0, 0];
const STEP = ['u', 'd', 'l', 'r'];
const PUSH = ['U', 'D', 'L', 'R'];
// States per room search (the generator keeps rooms its own search solves
// within this many) and over the whole set; work, never the wall clock.
const MAX_ROOM = 250000;
const MAX_TOTAL = 2000000;
let spent = 0;

type Board = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };

function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < w; x++) {
      const ch = x < row.length ? row[x]! : '#';
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/** Push distance from every square to its nearest goal, ignoring other boxes (reverse BFS from the goals: y is
 * one push from x when a box on y can be pushed onto x, the player standing behind it). -1: dead. */
function pushDist(bd: Board): Int32Array {
  const { w, h, wall, goals } = bd;
  const dist = new Int32Array(w * h).fill(-1);
  const q: number[] = [];
  for (const g of goals) {
    dist[g] = 0;
    q.push(g);
  }
  for (let qi = 0; qi < q.length; qi++) {
    const x = q[qi]!;
    const xx = x % w;
    const xy = (x / w) | 0;
    for (let k = 0; k < 4; k++) {
      const yx = xx - DX[k]!;
      const yy = xy - DY[k]!;
      const bx = yx - DX[k]!;
      const by = yy - DY[k]!;
      if (yx < 0 || yx >= w || yy < 0 || yy >= h || bx < 0 || bx >= w || by < 0 || by >= h) continue;
      const y = yy * w + yx;
      if (wall[y] || wall[by * w + bx] || dist[y] >= 0) continue;
      dist[y] = dist[x]! + 1;
      q.push(y);
    }
  }
  return dist;
}

/** Whether the box just pushed to t sits in a frozen 2x2 block of walls and boxes with a box off its goal.
 * Out of the board counts as a wall. */
function frozenAt(bd: Board, occ: Uint8Array, goalSet: Uint8Array, t: number): boolean {
  const { w, h, wall } = bd;
  const tx = t % w;
  const ty = (t / w) | 0;
  const filled = (x: number, y: number): boolean =>
    x < 0 || x >= w || y < 0 || y >= h || wall[y * w + x] === 1 || occ[y * w + x] === 1;
  const offGoal = (x: number, y: number): boolean =>
    x >= 0 && x < w && y >= 0 && y < h && occ[y * w + x] === 1 && goalSet[y * w + x] === 0;
  for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
    const ax = tx + ox;
    const ay = ty + oy;
    if (filled(ax, ay) && filled(ax + 1, ay) && filled(ax, ay + 1) && filled(ax + 1, ay + 1)) {
      if (offGoal(ax, ay) || offGoal(ax + 1, ay) || offGoal(ax, ay + 1) || offGoal(ax + 1, ay + 1)) return true;
    }
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters (up first on ties). */
function walkTo(bd: Board, occ: Uint8Array, from: number, to: number): string {
  const { w, h, wall } = bd;
  if (from === to) return '';
  const prev = new Int32Array(w * h).fill(-1);
  const how = new Int8Array(w * h);
  const q = [from];
  prev[from] = from;
  for (let qi = 0; qi < q.length; qi++) {
    const p = q[qi]!;
    if (p === to) break;
    const px = p % w;
    const py = (p / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = px + DX[k]!;
      const ny = py + DY[k]!;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nq = ny * w + nx;
      if (wall[nq] || occ[nq] || prev[nq] !== -1) continue;
      prev[nq] = p;
      how[nq] = k;
      q.push(nq);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = STEP[how[p]!]! + s;
  return s;
}

/** The push-optimal solution of one board: {pushes, moves, endPlayer}, or null when the state budget runs out
 * (or a box starts on a dead square). */
function solvePushes(bd: Board, maxStates: number): { pushes: number; moves: string; endPlayer: number } | null {
  const { w, h, wall, goals } = bd;
  const n = w * h;
  const goalSet = new Uint8Array(n);
  for (const g of goals) goalSet[g] = 1;
  const dist = pushDist(bd);
  for (const b of bd.boxes) if (dist[b]! < 0) return null;
  if (bd.boxes.every((b) => goalSet[b])) return { pushes: 0, moves: '', endPlayer: bd.player };

  const occ = new Uint8Array(n);
  const markA = new Int32Array(n);
  const markB = new Int32Array(n);
  const stack = new Int32Array(n);
  let stamp = 0;
  let lastMark = 0;
  // The squares the player reaches from `from` with boxes as walls, marked in `seen`; returns the lowest.
  const flood = (from: number, seen: Int32Array): number => {
    const st = ++stamp;
    lastMark = st;
    let low = from;
    let sp = 0;
    stack[sp++] = from;
    seen[from] = st;
    while (sp > 0) {
      const p = stack[--sp]!;
      if (p < low) low = p;
      const px = p % w;
      const py = (p / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = px + DX[k]!;
        const ny = py + DY[k]!;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (wall[q] || occ[q] || seen[q] === st) continue;
        seen[q] = st;
        stack[sp++] = q;
      }
    }
    return low;
  };
  // A state's key: the region's lowest square and the boxes' squares, packed in base n while it fits in a
  // double, else as text.
  const keyOf = (boxes: number[], low: number): number | string => {
    if (boxes.length <= 5) {
      let k = low;
      for (const b of boxes) k = k * n + b;
      return k;
    }
    return low + ':' + boxes.join(',');
  };
  const hOf = (boxes: number[]): number => {
    let s = 0;
    for (const b of boxes) s += dist[b]!;
    return s;
  };

  // The states in the order found: boxes, player square after the push, parent, and the push that made it.
  const sBoxes: number[][] = [bd.boxes.slice()];
  const sPlayer: number[] = [bd.player];
  const sParent: number[] = [-1];
  const sFrom: number[] = [-1];
  const sTo: number[] = [-1];
  const sDir: number[] = [-1];
  const sKey: (number | string)[] = [];
  for (const b of bd.boxes) occ[b] = 1;
  sKey.push(keyOf(bd.boxes, flood(bd.player, markA)));
  for (const b of bd.boxes) occ[b] = 0;
  // Best known cost and state per key: a key may be reached again cheaper before it is popped, and only the
  // cheapest generation counts.
  const bestG = new Map<number | string, number>([[sKey[0]!, 0]]);
  const bestIdx = new Map<number | string, number>([[sKey[0]!, 0]]);

  // Binary heap on (f, -g, sequence): lowest f first, deeper first, earliest first. Deterministic.
  const hf: number[] = [];
  const hg: number[] = [];
  const hs: number[] = [];
  const hi: number[] = [];
  const hLess = (a: number, b: number): boolean =>
    hf[a]! !== hf[b]! ? hf[a]! < hf[b]! : hg[a]! !== hg[b]! ? hg[a]! > hg[b]! : hs[a]! < hs[b]!;
  const hSwap = (a: number, b: number): void => {
    [hf[a], hf[b]] = [hf[b]!, hf[a]!];
    [hg[a], hg[b]] = [hg[b]!, hg[a]!];
    [hs[a], hs[b]] = [hs[b]!, hs[a]!];
    [hi[a], hi[b]] = [hi[b]!, hi[a]!];
  };
  const hPush = (f: number, g: number, s: number, i: number): void => {
    let c = hf.length;
    hf.push(f);
    hg.push(g);
    hs.push(s);
    hi.push(i);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (!hLess(c, p)) break;
      hSwap(c, p);
      c = p;
    }
  };
  const hPop = (): [number, number, number, number] => {
    const top: [number, number, number, number] = [hf[0]!, hg[0]!, hs[0]!, hi[0]!];
    const last = hf.length - 1;
    hf[0] = hf[last]!;
    hg[0] = hg[last]!;
    hs[0] = hs[last]!;
    hi[0] = hi[last]!;
    hf.pop();
    hg.pop();
    hs.pop();
    hi.pop();
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= hf.length) break;
      if (c + 1 < hf.length && hLess(c + 1, c)) c++;
      if (!hLess(c, i)) break;
      hSwap(c, i);
      i = c;
    }
    return top;
  };

  let seq = 0;
  hPush(hOf(bd.boxes), 0, seq++, 0);
  while (hf.length > 0) {
    const [, g, , si] = hPop();
    if (bestIdx.get(sKey[si]!) !== si) continue; // superseded by a cheaper path to the same key
    const boxes = sBoxes[si]!;
    if (boxes.every((b) => goalSet[b])) {
      // Rebuild the moves: walk to each push's square, then push.
      const chain: number[] = [];
      for (let s = si; s > 0; s = sParent[s]!) chain.push(s);
      chain.reverse();
      let moves = '';
      let player = bd.player;
      let cur = bd.boxes.slice();
      for (const s of chain) {
        const from = sFrom[s]!;
        const to = sTo[s]!;
        const dir = sDir[s]!;
        const d = DY[dir]! * w + DX[dir]!;
        for (const b of cur) occ[b] = 1;
        moves += walkTo(bd, occ, player, from - d);
        for (const b of cur) occ[b] = 0;
        moves += PUSH[dir]!;
        player = from;
        cur = sBoxes[s]!;
      }
      return { pushes: chain.length, moves, endPlayer: player };
    }
    for (const b of boxes) occ[b] = 1;
    flood(sPlayer[si]!, markA);
    const here = lastMark;
    for (let bi = 0; bi < boxes.length; bi++) {
      const b = boxes[bi]!;
      const bx = b % w;
      const by = (b / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = bx + DX[k]!;
        const ny = by + DY[k]!;
        const px = bx - DX[k]!;
        const py = by - DY[k]!;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || px < 0 || px >= w || py < 0 || py >= h) continue;
        const t = ny * w + nx;
        const stand = py * w + px;
        if (wall[t] || occ[t] || dist[t]! < 0 || markA[stand] !== here) continue;
        occ[b] = 0;
        occ[t] = 1;
        const frozen = frozenAt(bd, occ, goalSet, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!frozen) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, flood(b, markB));
        }
        occ[t] = 0;
        occ[b] = 1;
        if (frozen) continue;
        const prevG = bestG.get(key);
        if (prevG !== undefined && prevG <= g + 1) continue;
        if (sBoxes.length >= maxStates || spent >= MAX_TOTAL) {
          for (const x of boxes) occ[x] = 0;
          return null;
        }
        const ni = sBoxes.length;
        bestG.set(key, g + 1);
        bestIdx.set(key, ni);
        sBoxes.push(next!);
        sPlayer.push(b);
        sParent.push(si);
        sFrom.push(b);
        sTo.push(t);
        sDir.push(k);
        sKey.push(key);
        spent++;
        hPush(g + 1 + hOf(next!), g + 1, seq++, ni);
      }
    }
    for (const b of boxes) occ[b] = 0;
  }
  return null;
}

/** The level's rooms: cut the dead squares of the player's row (the hallway: a box there reaches no goal) out of
 * the floor; each part left that holds a box is a room. Null when a box starts in the hallway, a goal lies in
 * the cut, or some part holds more or fewer boxes than goals. */
function splitRooms(bd: Board): { boxes: number[]; goals: number[]; done: boolean }[] | null {
  const { w, h, wall, goals, boxes, player } = bd;
  const dist = pushDist(bd);
  const row = (player / w) | 0;
  const cut = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    const i = row * w + x;
    if (!wall[i] && dist[i]! < 0) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(w * h).fill(-1);
  const rooms: { boxes: number[]; goals: number[]; done: boolean }[] = [];
  for (let s = 0; s < w * h; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const cells = [s];
    part[s] = rooms.length;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const cx = c % w;
      const cy = (c / w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DX[k]!;
        const ny = cy + DY[k]!;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          cells.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [], done: false });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) {
    if (part[g]! < 0) return null;
    rooms[part[g]!]!.goals.push(g);
  }
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** Solve one level: the rooms' push-optimal solutions joined, the player walking on from where the last room
 * left it. '' when a room gives up (an empty answer is valid, worth no points). */
function solveLevel(text: string): string {
  const bd = parseLevel(text);
  const goalSet = new Set(bd.goals);
  if (bd.boxes.every((b) => goalSet.has(b))) return '';
  const rooms = splitRooms(bd);
  if (rooms === null) {
    const r = solvePushes(bd, MAX_ROOM);
    return r ? r.moves : '';
  }
  let player = bd.player;
  let moves = '';
  for (const room of rooms) {
    const wall = bd.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const c of other.done ? other.goals : other.boxes) wall[c] = 1;
    }
    const sub: Board = {
      w: bd.w,
      h: bd.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const r = solvePushes(sub, MAX_ROOM);
    if (!r) return '';
    moves += r.moves;
    player = r.endPlayer;
    room.done = true;
  }
  return moves;
}

for (const id of readdirSync(IN).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(IN, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'solution.txt'), `${moves}\n`);
}
