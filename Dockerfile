# Debian-based (glibc), not alpine: the NVIDIA Container Toolkit injects
# glibc nvidia-smi/libraries into the container for GPU monitoring, and
# those don't run on alpine's musl libc.
FROM node:20-bookworm-slim

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
