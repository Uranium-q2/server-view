# Debian-based (glibc), not alpine: the NVIDIA Container Toolkit injects
# glibc nvidia-smi/libraries into the container for GPU monitoring, and
# those don't run on alpine's musl libc.
FROM node:20-bookworm-slim

# pciutils provides lspci, which systeminformation uses to enumerate GPU
# controllers in the first place - without it nvidia-smi output has nothing
# to attach to and graphics() reports no controllers at all.
RUN apt-get update && apt-get install -y --no-install-recommends pciutils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
# data/ is intentionally not copied: it holds runtime state (session secret,
# .env) and is created automatically on first run.

EXPOSE 8642

CMD ["node", "server.js"]
