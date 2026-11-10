# Server View

Lekki dashboard do podglądu stanu serwera (CPU, temperatura, RAM, swap, dyski, sieć) w stylu zbliżonym do panelu Pterodactyl. Bez terminala i bez przycisków start/stop — tylko podgląd na żywo (odświeżanie co 2 sekundy).

Dane czytane są przez bibliotekę `systeminformation`, która na Linuksie korzysta m.in. z `lm-sensors` / `/sys/class/hwmon` — czyli z czujników wbudowanych w płytę główną (np. Gigabyte B760 + chip Super I/O, zwykle obsługiwany przez moduł `nct6775`).

## Wymagania na Ubuntu Server

```bash
sudo apt update
sudo apt install -y lm-sensors
sudo sensors-detect --auto   # wykryje i załaduje moduł czujników (np. nct6775)
sensors                      # sprawdź, czy widać temperaturę CPU
```

Jeśli `sensors` nic nie pokazuje, doładuj moduł ręcznie i dodaj go na stałe:

```bash
sudo modprobe nct6775
echo nct6775 | sudo tee -a /etc/modules
```

## Uruchomienie natywne (bez Dockera)

```bash
# wymaga Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd server-view
npm install
npm start
```

Panel będzie dostępny pod `http://IP-SERWERA:8642`.

### Jako usługa systemd (opcjonalnie)

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

## Uruchomienie w Dockerze (docker compose)

Kontener potrzebuje dostępu do hosta (`/proc`, `/sys`, `pid: host`), żeby pokazywać prawdziwe dane serwera, a nie tylko statystyki samego kontenera — to standardowe podejście stosowane przez narzędzia monitorujące host z poziomu Dockera.

Na hoście nadal musi być zainstalowany i skonfigurowany `lm-sensors` (patrz wyżej) — kontener tylko odczytuje wystawione przez jądro pliki w `/sys/class/hwmon`, moduł musi być załadowany po stronie hosta.

```bash
docker compose up -d --build
```

Panel będzie dostępny pod `http://IP-SERWERA:8642`. Port można zmienić w `docker-compose.yml` (sekcja `ports`).

## Struktura projektu

- `server.js` — backend Express, endpoint `GET /api/stats`
- `public/` — statyczny frontend (HTML/CSS/JS, wykresy przez Chart.js z CDN)
- `Dockerfile`, `docker-compose.yml` — konteneryzacja

## Czego celowo brakuje

Zgodnie z założeniem: brak wbudowanego terminala i brak akcji start/stop/restart serwera — to czysty podgląd metryk.
