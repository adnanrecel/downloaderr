FROM node:18

WORKDIR /app

# FFmpeg ve diğer gerekli paketleri yükle
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Pip'i güncelle ve yt-dlp'yi yükle
RUN python3 -m pip install --upgrade pip
RUN pip3 install --no-cache-dir yt-dlp -v

# Alternatif olarak yt-dlp binary dosyasını doğrudan kopyala
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

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