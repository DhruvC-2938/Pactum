FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .
RUN npm run build

EXPOSE 3000 9090

USER node

CMD ["npm", "start"]
