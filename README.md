# YABSOD

Yet Another Blue Screen of Death.

A terminal-first meme CLI that tracks BSOD/app crashes, turns them into charts, and lets you flex instability stats.

## Install

```bash
npm i -g yabsod
```

## Commands

- `yabsod jot [--background] [--rehydrate]` - collect crash events from Windows sources, store in sqlite, or refresh metadata for existing rows
- `yabsod stats [--range week|month|all-time]` - render crash dashboard with heatmap and bar charts
- `yabsod achievements [-l|--list] [--updated|--unlocked|--locked] [-f <query>]`
- `yabsod list [filters...]` - list indexed crash events
- `yabsod view <id|~N> [--format default|json|md]` - inspect one crash event in detail
- `yabsod help [command]`

## Dev

```bash
bun install
bun run transpile-esm
bun run start -- stats
```

## Data sources

- Windows Event Log (`Get-WinEvent`)
- Reliability Monitor records (`Win32_ReliabilityRecords`)
- local file system hints (Minidump + WER folders)
