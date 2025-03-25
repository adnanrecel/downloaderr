# YouTube Video İndirici

YouTube videolarını çeşitli formatlarda indirmek için basit bir web uygulaması.

## Özellikler

- Video bilgilerini ve mevcut formatları görüntüleme
- Çeşitli çözünürlük ve kalite seçenekleriyle video indirme
- Sadece ses indirme seçeneği
- Doğrudan bilgisayara indirme

## Yerel Ortamda Çalıştırma

### Gereksinimler

- Node.js (v14 veya üstü)
- npm veya yarn

### Kurulum

1. Projeyi klonlayın:
   ```
   git clone https://github.com/kullaniciadi/youtube-download.git
   cd youtube-download
   ```

2. Bağımlılıkları yükleyin:
   ```
   npm install
   ```

3. Uygulamayı başlatın:
   ```
   npm start
   ```

4. Tarayıcınızda şu adresi açın: `http://localhost:3000`

## Render.com üzerinde Deploy Etme

1. GitHub deposunu Render.com'a bağlayın
2. "Blueprint" seçeneğini kullanarak `render.yaml` dosyasını kullanın
3. veya "New Web Service" seçeneğini seçin ve şu ayarları yapın:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Advanced: "Add Docker" seçeneğini aktif edin

## Teknolojiler

- Node.js
- Express.js
- yt-dlp / youtube-dl
- FFmpeg (Render üzerinde otomatik kurulur)

## Lisans

MIT 