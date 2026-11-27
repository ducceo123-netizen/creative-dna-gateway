FROM node:24.14.1-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /app
COPY v2/package.json v2/package-lock.json ./v2/
RUN npm ci --prefix v2 --include=dev \
    && ln -s v2/node_modules node_modules \
    && cd v2 && npx playwright install --with-deps chromium
COPY . .
RUN npm run build --prefix v2 \
    && chown -R node:node /app /opt/playwright
USER node
EXPOSE 10000
CMD ["node", "--import", "tsx", "v2/server.ts"]
