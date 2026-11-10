FROM node:20-bullseye-slim

# Mag-install ng Python, FFmpeg, at curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Mag-install ng pinakabagong yt-dlp direkta mula sa official source
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Railway sets PORT dynamically; fallback to 4317
ENV PORT=4317
ENV HOST=0.0.0.0

EXPOSE 4317

CMD ["node", "server.js"]