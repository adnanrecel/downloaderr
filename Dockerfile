FROM node:18-bullseye-slim

WORKDIR /app

# FFmpeg ve curl ve python3 yükle
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp binary'sini doğrudan indir
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp
RUN ln -s /usr/bin/python3 /usr/bin/python

# Çalıştığından emin ol
RUN /usr/local/bin/yt-dlp --version

# Uygulama bağımlılıklarını kopyala ve yükle
COPY package*.json ./
RUN npm install

# Uygulama kaynak kodunu kopyala
COPY . .

# NODE_ENV ortam değişkenini production olarak ayarla
ENV NODE_ENV=production

# Uygulama portunu açıkla
ENV PORT=10000
EXPOSE 10000

# Uygulamayı başlat
CMD ["npm", "start"] 