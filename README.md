# Server View

A lightweight server dashboard styled after Pterodactyl, with three pages:

- **Overview** — CPU load, CPU temperature, RAM, swap, disks, network, all reading straight from the motherboard's own sensors (`lm-sensors` / `/sys/class/hwmon` on Linux), refreshed every 2 seconds.
- **Docker Containers** — read-only status (running/partial/stopped) and a "View logs" button (`docker compose logs --tail=300`) for whatever Docker Compose projects you register in Settings. There is deliberately no start/stop/restart and no terminal — only ever read-only commands run against the host, to keep the attack surface small.
- **Settings** — add/edit/delete managed containers: just a name and the project's location (folder on disk).

Every page requires signing in with Google first — see **Google login setup** below. This is meant to be run on a trusted local network only; login is an extra safety net, not a reason to expose it to the internet.

## Google login setup

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create (or reuse) a project, then **Create Credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins**, add every origin you'll open the dashboard from, e.g. `http://localhost:8642` and `http://YOUR-SERVER-LAN-IP:8642`. No redirect URI or client secret is needed.
3. Copy `.env.example` to `.env` and fill in:
   ```
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   ALLOWED_EMAILS=you@gmail.com
   ```
   `ALLOWED_EMAILS` is a comma-separated allow-list — anyone signing in with a Google account not on this list is rejected even though Google itself authenticated them.
4. Start the server (`npm start`, or `docker compose up -d --build`) and open the dashboard — you'll land on `/login.html`.

The session is a signed, httpOnly cookie (no server-side session store needed); its signing key is auto-generated into `data/session-secret.txt` on first run if `SESSION_SECRET` isn't set in `.env`, so sessions survive restarts.

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

Running natively, the Docker Containers status/logs commands run `cd <location> && docker compose ...` directly, so `location` must be a path that exists on this machine.

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
- the Docker Containers status/logs commands run **on the host itself** (not inside this container) by re-entering the host's namespaces with `nsenter` — otherwise they couldn't see your projects or your host's Docker daemon at all.

**This still means the container has root-equivalent access to the host**, even though the only commands it ever runs are the fixed, read-only `docker compose ps` / `docker compose logs`. Only run it on a network you trust.

> **Using rootless Docker?** The `nsenter` trick above does not work there: a rootless Docker daemon maps "root" inside the container to an unprivileged user on the host via a user namespace, so `privileged: true` does not grant it real host access, and `nsenter -t 1 ...` will fail with a permission error. Overview stats (read from mounted `/proc`, `/sys`) still work fine in that setup, but for Docker Containers status/logs to work, run Server View natively instead (see **Running natively** above) — it then talks to Docker directly, with no namespace tricks needed.

`lm-sensors` must still be installed and configured on the host (see above) — the container only reads what the kernel already exposes under `/sys/class/hwmon`.

Container settings (the list configured on the Settings page) are persisted in `./data/containers.json`, which is bind-mounted into the container so it survives rebuilds.

## Project layout

- `server.js` — Express app + HTTP server (stats API, container CRUD, logs action, auth routes)
- `lib/auth.js` — Google ID token verification, signed session cookies, the `requireAuth` gate
- `lib/containers-store.js` — reads/writes `data/containers.json`
- `lib/docker-actions.js` — runs the fixed, read-only `docker compose ps` / `docker compose logs` commands and streams output over SSE
- `lib/host-exec.js` — the `nsenter` host-escape logic used when running inside Docker
- `public/` — static frontend (vanilla JS, Chart.js for sparklines, Google Identity Services for login)
- `Dockerfile`, `docker-compose.yml` — containerization
- `.env` (not committed — copy from `.env.example`) — Google client ID, allowed emails, optional session secret
