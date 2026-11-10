# Server View

A lightweight server dashboard styled after Pterodactyl, with four pages:

- **Overview** — CPU load, CPU temperature, RAM, swap, disks, network, all reading straight from the motherboard's own sensors (`lm-sensors` / `/sys/class/hwmon` on Linux), refreshed every 2 seconds.
- **Docker Containers** — Start / Stop / Restart buttons for whatever Docker Compose projects you register in Settings, with a live console showing the command's output.
- **Settings** — add/edit/delete managed containers: name, location (the project's folder on disk), custom Start/Stop/Restart commands (defaults to `docker compose up -d --build` / `docker compose down` / `docker compose restart`, but fully overridable per project — handy for projects with a non-standard setup), and a per-button enable/disable toggle.
- **Terminal** — a real, interactive shell in the browser (xterm.js + WebSocket).

There is intentionally **no authentication**. This tool is meant to be run on a trusted local network only — never expose it to the internet.

## Requirements on the Ubuntu Server host

```bash
sudo apt update
sudo apt install -y lm-sensors
sudo sensors-detect --auto   # detects and loads the sensor module (e.g. nct6775 on Gigabyte boards)
sensors                      # check that CPU temperature shows up
```

If `sensors` shows nothing, load the module manually and persist it:

```bash
sudo modprobe nct6775
echo nct6775 | sudo tee -a /etc/modules
```

## Running natively (no Docker)

```bash
# requires Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd server-view
npm install
npm start
```

The dashboard will be available at `http://SERVER-IP:8642`.

Running natively, the Terminal page opens a shell directly on the host (no extra setup needed), and Docker Containers actions run `cd <location> && <command>` directly, so `location` must be a path that exists on this machine.

### As a systemd service (optional)

```ini
# /etc/systemd/system/server-view.service
[Unit]
Description=Server View dashboard
After=network.target

[Service]
WorkingDirectory=/opt/server-view
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=root

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now server-view
```

## Running with Docker (docker compose)

```bash
docker compose up -d --build
```

The container runs with `privileged: true` and `pid: host`. This is required so that:

- the Overview page can read the host's real CPU/RAM/temperature (via mounted `/proc` and `/sys`), and
- the Terminal page and Docker Containers actions run **on the host itself** (not inside this container) by re-entering the host's namespaces with `nsenter` — otherwise "Terminal" would just be a shell inside an isolated container, and "Docker Containers" commands couldn't see your projects or your host's Docker daemon.

**This means the container has root-equivalent access to the host.** Only run it on a network you trust — this is the same trade-off the UI itself assumes by shipping with no login.

`lm-sensors` must still be installed and configured on the host (see above) — the container only reads what the kernel already exposes under `/sys/class/hwmon`.

Container settings (the list configured on the Settings page) are persisted in `./data/containers.json`, which is bind-mounted into the container so it survives rebuilds.

## Project layout

- `server.js` — Express app + HTTP server (stats API, container CRUD/actions, WebSocket upgrade for the terminal)
- `lib/containers-store.js` — reads/writes `data/containers.json`
- `lib/docker-actions.js` — runs Start/Stop/Restart commands and streams their output over SSE
- `lib/terminal.js` — WebSocket-based shell (uses `node-pty` if available, otherwise a plain piped shell)
- `lib/host-exec.js` — the `nsenter` host-escape logic used when running inside Docker
- `public/` — static frontend (vanilla JS, Chart.js for sparklines, xterm.js for the terminal)
- `Dockerfile`, `docker-compose.yml` — containerization
