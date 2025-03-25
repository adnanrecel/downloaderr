# YouTube Video İndirici

Bu uygulama, YouTube videolarını farklı kalitelerde indirmenizi sağlayan basit bir web uygulamasıdır.

## Özellikler

- YouTube video URL'si girişi
- Video hakkında bilgi görüntüleme (başlık, yükleyen, süre, vb.)
- Farklı video kalitelerinde indirme seçeneği
- İndirilen videolar MP4 formatında ve ses içerir
- Kolay kullanımlı arayüz

## Gereksinimler

- Python 3.6+
- Flask
- pytube
- ffmpeg-python
- gunicorn (yalnızca dağıtım için)

## Kurulum

1. Depoyu klonlayın:
```
git clone https://github.com/kullaniciadi/youtube-download.git
cd youtube-download
```

2. Gerekli paketleri yükleyin:
```
pip install -r requirements.txt
```

3. Uygulamayı çalıştırın:
```
python app.py
```

4. Tarayıcınızda şu adrese gidin: `http://127.0.0.1:5000`

## Kullanım

1. Ana sayfada, indirmek istediğiniz YouTube video URL'sini girin.
2. "Video Bilgilerini Al" düğmesine tıklayın.
3. Kullanılabilir video kalitelerinden birini seçin.
4. "Videoyu İndir" düğmesine tıklayın.
5. İndirme tamamlandığında, dosyayı bilgisayarınıza indirin.

## Dağıtım

### Render'a Dağıtım

1. Render'da bir hesap oluşturun.
2. "New Web Service" seçeneğine tıklayın.
3. GitHub deponuzu bağlayın.
4. Aşağıdaki ayarları yapın:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn app:app`
5. "Create Web Service" düğmesine tıklayın.

## Lisans

Bu proje MIT lisansı altında lisanslanmıştır.

## Uyarı

Bu uygulama yalnızca telif hakkına sahip olmadığınız YouTube içeriklerini indirmek için kullanılmamalıdır. Telif hakkı yasalarına uygun şekilde kullanım sizin sorumluluğunuzdadır. 