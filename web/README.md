# TestPilot 5250 – web dashboard

React 19 single-page app. Talks to the TestPilot server per `../docs/API.md`.

    npm install          # react, react-dom, d3-scale, d3-shape, esbuild
    npm run build        # -> dist/ (served by the TestPilot server)
    npm run dev          # watch + http://localhost:5173, proxies /api and /ws to :4250
    npm run preview      # serve dist/ on :4173 with the same proxy

Open `http://localhost:5173/?mock=1` to browse every page with fixture data (no server needed).
Routing is hash based (`#/runs/<id>`), so `dist/` works from any static host.
Set `TP_API_HOST` / `TP_API_PORT` to proxy to a server elsewhere.
