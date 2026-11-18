FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx vite build
ENV NODE_ENV=production
CMD ["npx", "tsx", "server.ts"]
