FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PAODING_HOST=0.0.0.0 \
    PAODING_PORT=4177

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git build-essential cmake python3 \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && git clone --depth=1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp \
  && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /tmp/whisper.cpp/build --config Release -j"$(nproc)" \
  && cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli \
  && rm -rf /tmp/whisper.cpp /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /data/recipes /data/jobs /data/models

EXPOSE 4177
CMD ["node", "app/server.mjs"]
