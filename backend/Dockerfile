FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY tsconfig.json ./
RUN npx tsc || true
EXPOSE 3001
ENV PORT=3001
CMD ["node", "--import", "tsx", "src/server.ts"]
