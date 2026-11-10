FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg python3 python3-pip curl ca-certificates \
    && pip3 install --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:${PATH}"

WORKDIR /app
COPY . .
ENV HOST=0.0.0.0
CMD ["npm", "start"]
