[![sokoban-solver-01](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/c/sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/xiacai520/sokoban-solver-01/rank.svg)](https://make.fun/c/sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/xiacai520/sokoban-solver-01/reward.svg)](https://make.fun/c/sokoban-solver-01-run-20261121)

# sokoban-solver-01

A push-optimal Sokoban solver — entry for
[Build the best Sokoban solver, 21 November 2026](https://make.fun/c/sokoban-solver-01-run-20261121)
(`sokoban-solver-01-run-20261121`).

`main.ts` (Node 22, no dependencies) reads `/input/<id>/level.txt` and
writes LURD moves to `/output/<id>/solution.txt`. It splits each level
into its rooms (a box pushed out of its room can never come back, so the
level's push optimum is the sum of its rooms'), then solves each room with
A* over pushes: the heuristic is the sum of per-box push distances to the
nearest goal, with dead-square and frozen-2x2 pruning. No clock is read
and nothing is random, so two runs write identical bytes.

Practice set: 1,000,000 / 1,000,000 — every instance solved in exactly its
push-optimal count (13, 16, 29, 47, 60 pushes).
