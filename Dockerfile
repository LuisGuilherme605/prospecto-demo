# Imagem de producao do Prospecto.
#
# Nao ha etapa de build: o projeto nao tem dependencias nem transpilacao, entao a
# imagem e o codigo-fonte sobre o Node oficial. Resultado: ~120 MB, sem
# node_modules, sem superficie de ataque de pacote de terceiros.

FROM node:22-alpine

# `tini` como PID 1 encaminha SIGTERM corretamente. Sem ele, o Node nao recebe o
# sinal de parada e o orquestrador mata o processo a forca depois do timeout --
# deixando arquivo WAL do SQLite pendurado no volume.
RUN apk add --no-cache tini

WORKDIR /app

# Copia so o que roda em producao. Testes e exemplos ficam de fora.
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY public ./public

# O volume de dados pertence ao usuario sem privilegio: um comprometimento da
# aplicacao nao vira root no container.
RUN mkdir -p /dados && chown -R node:node /app /dados
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PROSPECTO_BANCO=/dados/prospecto.db \
    PROSPECTO_ATRAS_DE_PROXY=1

VOLUME ["/dados"]
EXPOSE 3000

# O healthcheck usa /api/saude, que fica aberto justamente para isso.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--experimental-sqlite", "bin/prospecto.js", "servir"]
