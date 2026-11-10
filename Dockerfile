FROM node:20-alpine

# util-linux provides `nsenter`, used to run the read-only "docker compose
# ps"/"docker compose logs" commands on the HOST instead of inside this
# container (see lib/host-exec.js). Requires the container to run with
# privileged: true + pid: host (docker-compose.yml).
RUN apk add --no-cache util-linux

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
# data/ is intentionally not copied: it holds runtime state (container
# configs, session secret, .env) and is created automatically on first run.

EXPOSE 8642

CMD ["node", "server.js"]
