FROM node:18

WORKDIR /app

# FFmpeg ve diğer gerekli paketleri yükle
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp'yi yükle
RUN pip3 install yt-dlp

# Uygulama bağımlılıklarını kopyala ve yükle
COPY package*.json ./
RUN npm install

# Uygulama kaynak kodunu kopyala
COPY . .

# Uygulama portunu açıkla
ENV PORT=10000
EXPOSE 10000

# Uygulamayı başlat
CMD ["npm", "start"] 