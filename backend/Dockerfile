FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p uploads/lab-reports uploads/radiology-reports uploads/patient-documents

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

RUN chown -R node:node /app
USER node

CMD ["node", "src/server.js"]
