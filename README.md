# Volk vs Gaethje Simulator

A 3D, position-based Monte Carlo model of Alexander Volkanovski vs Justin Gaethje at 155 lb.
Open `volk-gaethje-simulator.html` in a browser to watch a fight and run the tally (it loads three.js
from cdnjs, so it needs an internet connection).

- Rebuild after editing `src/`: `python3 build.py`
- Engine presets and backtest: `node tests/test_engine2.js 30000`
- Dev pages: `python3 -m http.server 8000`, then open `/tests/dev3d.html` or `/tests/dev3d_live.html#ko`

Start a Claude Code session in this folder and it picks up `CLAUDE.md` automatically.
The findings and sources live in `HANDOFF.md`; the original chat is in `CONVERSATION.md`.

A model of the matchup, not a forecast, and not betting advice.
