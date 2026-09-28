FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 3004
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost:${PORT:-3004}/health || exit 1
CMD ["node", "src/index.js"]
