# Server View

A single-page, read-only server monitoring dashboard styled after Pterodactyl: CPU load, CPU temperature, RAM, swap, disks, network, and fan RPM (when the board/kernel exposes it), all reading straight from the motherboard's own sensors (`lm-sensors` / `/sys/class/hwmon` on Linux), refreshed every 2 seconds.

Signing in with Discord is required first — see **Discord login setup** below. This is meant to be run on a trusted local network only; login is an extra safety net, not a reason to expose it to the internet.

## Discord login setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application** (or reuse one you have).
2. Open **OAuth2** in the left sidebar. Copy the **Client ID** and **Client Secret**.
3. Under **Redirects**, click **Add Redirect** and add exactly:
   ```
   http://YOUR-SERVER-LAN-IP:8642/auth/discord/callback
   ```
   (must match byte-for-byte what's in `.env`, including `http://` and the port) — save.
4. Get your Discord user ID: in Discord, **User Settings → Advanced → Developer Mode** (toggle on), then right-click your own profile/avatar → **Copy User ID**.
5. Copy `.env.example` to `.env` and fill in:
   ```
   DISCORD_CLIENT_ID=your-application-id
   DISCORD_CLIENT_SECRET=your-client-secret
   DISCORD_REDIRECT_URI=http://YOUR-SERVER-LAN-IP:8642/auth/discord/callback
   ALLOWED_DISCORD_IDS=123456789012345678
   ```
   `ALLOWED_DISCORD_IDS` is a comma-separated allow-list of Discord user IDs — anyone signing in with a Discord account not on this list is rejected even though Discord itself authenticated them.
6. Start the server (`npm start`, or `docker compose up -d --build`) and open the dashboard — you'll land on `/login.html`.

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

**Fan RPM depends entirely on your board/kernel.** Server View reads `/sys/class/hwmon/*/fan*_input` directly (the same data `lm-sensors` itself uses) — if that shows up under `sensors`/`lsmod`, it shows up on the dashboard automatically, with a real label (e.g. "CPU Fan") when the driver provides one. Some boards' Super I/O chip has no Linux driver at all yet, in which case no fan data exists to read and the Fans card just says so.

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

`/proc` and `/sys` are bind-mounted read-only so the Overview page reads the host's real CPU/RAM/temperature/fan data instead of the container's own isolated view, and `uts: host` makes it report the host's actual hostname instead of the container's auto-generated one. None of this requires `privileged` or `pid: host` — Server View doesn't run any commands against the host, it only reads already-exposed files.

`lm-sensors` must still be installed and configured on the host (see above) — the container only reads what the kernel already exposes under `/sys/class/hwmon`.

## Project layout

- `server.js` — Express app + HTTP server (stats API, auth routes)
- `lib/auth.js` — Discord OAuth2 code exchange, signed session cookies, the `requireAuth` gate
- `lib/fans.js` — reads fan RPM + labels from `/sys/class/hwmon`
- `public/` — static frontend (vanilla JS, Chart.js for sparklines)
- `Dockerfile`, `docker-compose.yml` — containerization
- `.env` (not committed — copy from `.env.example`) — Discord client ID/secret/redirect URI, allowed Discord user IDs, optional session secret
