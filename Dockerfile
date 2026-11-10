FROM node:20-alpine

# util-linux provides `nsenter`, used to run commands/shells on the HOST
# instead of inside this container (see lib/host-exec.js). Requires the
# container to run with privileged: true + pid: host (docker-compose.yml).
RUN apk add --no-cache util-linux

WORKDIR /app

COPY package.json ./
# python3/make/g++ are only needed to compile the optional node-pty native
# module; removed again right after install to keep the final image small.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm install --omit=dev \
    && apk del .build-deps

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY data ./data

EXPOSE 8642

CMD ["node", "server.js"]
