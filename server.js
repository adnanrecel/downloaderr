const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const http = require('http');

const app = express();
// Başlangıç port numarası
let PORT = process.env.PORT || 3000;
let server;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Download klasörünü oluştur (yoksa)
const downloadDir = path.join(__dirname, 'download');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

// İlerleme verilerini saklamak için
const progressTracker = {};

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Video bilgilerini alma
app.get('/api/video-info', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL parametresi eksik' });
        }
        
        console.log('Video bilgileri alınıyor:', url);
        
        // YouTube video ID'sini çıkar
        const videoId = extractVideoId(url);
        if (!videoId) {
            return res.status(400).json({ error: 'Geçersiz YouTube URL\'si' });
        }
        
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // youtube-dl ile video bilgilerini al
        getVideoInfo(videoUrl)
            .then(info => {
                return res.json(info);
            })
            .catch(error => {
                console.error('Video bilgilerini alma hatası:', error);
                return res.status(500).json({ error: error.message || 'Video bilgileri alınamadı.' });
            });
        
    } catch (error) {
        console.error('Video bilgileri alınırken hata:', error);
        return res.status(500).json({ error: error.message });
    }
});

// İndirme isteği
app.post('/api/download', async (req, res) => {
    try {
        const { videoId, itag, hasVideo, hasAudio } = req.body;
        
        if (!videoId || !itag) {
            return res.status(400).json({ error: 'Video ID ve itag gerekli' });
        }
        
        // İlerleme takipçisini başlat
        progressTracker[videoId] = {
            progress: 0,
            status: 'İndirme başlatılıyor...',
            complete: false,
            error: null
        };
        
        // Asenkron olarak indirme işlemini başlat
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        
        // İndirme işlemi bir boru hattında çalışacak
        downloadVideo(videoUrl, videoId, itag, hasVideo, hasAudio)
            .then(outputFile => {
                return res.json({ message: 'İndirme başlatıldı', videoId, outputFile });
            })
            .catch(error => {
                console.error('İndirme başlatılırken hata:', error);
                return res.status(500).json({ error: error.message });
            });
        
    } catch (error) {
        console.error('İndirme başlatılırken hata:', error);
        return res.status(500).json({ error: error.message });
    }
});

// İlerleme olayları
app.get('/api/progress/:videoId', (req, res) => {
    const { videoId } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // SSE başlatma olayı
    res.write(`data: ${JSON.stringify({ status: 'İndirme başlatılıyor...' })}\n\n`);
    
    // İlerleme güncellemelerini göndermek için interval
    const intervalId = setInterval(() => {
        if (!progressTracker[videoId]) {
            clearInterval(intervalId);
            return res.end();
        }
        
        res.write(`data: ${JSON.stringify(progressTracker[videoId])}\n\n`);
        
        if (progressTracker[videoId].complete || progressTracker[videoId].error) {
            clearInterval(intervalId);
            
            // İşlem tamamlandıktan sonra temizle
            if (progressTracker[videoId].complete) {
                console.log(`İşlem tamamlandı, ${videoId} için progressTracker temizleme planlandı (3 dakika sonra)`);
                setTimeout(() => {
                    // Tekrar kontrol et, çünkü arada silinmiş olabilir
                    if (progressTracker[videoId]) {
                        console.log(`${videoId} için progressTracker temizleniyor`);
                        delete progressTracker[videoId];
                    }
                }, 180000); // 3 dakika sonra temizle (60000ms -> 1 dakika)
            }
        }
    }, 1000);
    
    // Bağlantı kapandığında interval'i temizle
    req.on('close', () => {
        clearInterval(intervalId);
    });
});

// İndirilen dosyayı sunma
app.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(downloadDir, filename);
    
    if (!fs.existsSync(filePath)) {
        console.error(`Dosya bulunamadı: ${filePath}`);
        return res.status(404).json({ error: 'Dosya bulunamadı. İndirme işlemi tamamlanmadı veya dosya silinmiş olabilir.' });
    }
    
    // Dosya boyutunu kontrol et
    try {
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            console.error(`Dosya boş: ${filePath}`);
            return res.status(404).json({ error: 'Dosya boş veya bozuk.' });
        }
        
        console.log(`İndirilen dosya boyutu: ${Math.round(stats.size / (1024 * 1024))} MB`);
    } catch (err) {
        console.error(`Dosya stat hatası: ${err.message}`);
        return res.status(500).json({ error: 'Dosya bilgileri okunamadı: ' + err.message });
    }
    
    // Dosya uzantısını al
    const fileExt = path.extname(filename).toLowerCase().substring(1);
    
    // Uzantıya göre content-type belirleme
    const contentTypes = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'm4a': 'audio/mp4',
        'opus': 'audio/opus',
        'ogg': 'audio/ogg'
    };
    
    // Gerçek dosya adını ayarla
    const realFilename = path.basename(filename);
    
    // Content-Type başlığını ayarla (eğer bilinen bir uzantı ise)
    const contentType = contentTypes[fileExt] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    console.log(`Dosya türü: ${contentType} (${fileExt} uzantısı için)`);
    
    // Tarayıcıda açmak yerine indirme olarak ayarla
    res.setHeader('Content-Disposition', `attachment; filename="${realFilename}"`);
    
    // Dosyayı akış olarak gönder
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Hata durumunda
    fileStream.on('error', (err) => {
        console.error('Dosya gönderme hatası:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Dosya indirme hatası: ' + err.message });
        }
    });
    
    console.log(`${filename} dosyası indirme için kullanıcıya sunuldu`);
});

// Video bilgilerini çeken fonksiyon
function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        // Tarayıcı bilgisi (user-agent) ekle
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        
        // yt-dlp ile doğrudan mevcut formatları içeren video bilgilerini al
        const ytdlpPath = process.env.NODE_ENV === 'production' ? '/usr/local/bin/yt-dlp' : path.join(__dirname, 'bin', 'yt-dlp.exe');
        const command = process.env.NODE_ENV === 'production' 
            ? `${ytdlpPath} -F "${url}" --user-agent "${userAgent}" --no-check-certificate`
            : `"${ytdlpPath}" -F "${url}" --user-agent "${userAgent}" --no-check-certificate`;
        
        console.log("Video formatları sorgulanıyor. Komut:", command);
        
        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error('yt-dlp format sorgusu hatası:', error);
                console.error('yt-dlp stderr:', stderr);
                
                // Hata durumunda temel video bilgilerini al ve minimum format listesi sun
                fetchBasicInfo(url, userAgent, resolve, reject);
                return;
            }
            
            try {
                // Format çıktısını işle
                const formatOutput = stdout;
                console.log("Format sorgusu yanıtı alındı, işleniyor...");
                
                // yt-dlp format çıktısını satırlara böl
                const lines = formatOutput.split('\n');
                const formats = [];
                
                // Başlık satırını bul
                const titleLine = lines.find(line => line.startsWith('[info]'));
                let title = "YouTube Video";
                if (titleLine) {
                    const titleMatch = titleLine.match(/\[info\] (.*?):/);
                    if (titleMatch && titleMatch[1]) {
                        title = titleMatch[1];
                    }
                }
                
                // Video ID
                const videoId = extractVideoId(url);
                const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                
                // Format satırlarını işle
                // Formatları işle, ID, çözünürlük ve açıklama bilgilerini al
                for (const line of lines) {
                    // Format satırı örneği: 22 mp4 1280x720 30fps avc1.64001F,mp4a.40.2 (video+audio)
                    const formatMatch = line.match(/^(\d+)\s+(\w+)\s+(.+?)(\s+\((.+)\))?$/);
                    if (formatMatch) {
                        const formatId = formatMatch[1];
                        const container = formatMatch[2];
                        const description = formatMatch[3];
                        const formatType = formatMatch[5] || '';
                        
                        const hasVideo = formatType.includes('video') || description.includes('x') || description.includes('fps');
                        const hasAudio = formatType.includes('audio');
                        
                        let qualityLabel = description;
                        // Çözünürlük bilgisini al
                        const resMatch = description.match(/(\d+)x(\d+)/);
                        if (resMatch) {
                            qualityLabel = `${resMatch[2]}p`;
                            // FPS bilgisini ekle
                            const fpsMatch = description.match(/(\d+)fps/);
                            if (fpsMatch) {
                                qualityLabel += ` ${fpsMatch[1]}fps`;
                            }
                        } else if (description.includes('audio only')) {
                            // Ses kalitesi
                            const kbpsMatch = description.match(/(\d+)k/);
                            if (kbpsMatch) {
                                qualityLabel = `${kbpsMatch[1]}kbps`;
                            } else {
                                qualityLabel = 'Audio';
                            }
                        }
                        
                        let formatNote = '';
                        if (hasVideo && hasAudio) {
                            formatNote = `${qualityLabel} (Video + Ses)`;
                        } else if (hasVideo) {
                            formatNote = `${qualityLabel} (Sadece Video)`;
                        } else if (hasAudio) {
                            formatNote = `${qualityLabel} (Sadece Ses)`;
                        }
                        
                        formats.push({
                            itag: formatId,
                            qualityLabel: qualityLabel,
                            container: container,
                            hasVideo: hasVideo,
                            hasAudio: hasAudio,
                            format_note: formatNote,
                            filesize: 'Otomatik'
                        });
                    }
                }
                
                // Özel formatları ekle - kombinasyonlar
                // En yüksek kaliteli video + ses
                if (formats.length > 0) {
                    const bestVideo = formats.find(f => f.hasVideo && !f.hasAudio);
                    const bestAudio = formats.find(f => f.hasAudio && !f.hasVideo);
                    
                    if (bestVideo && bestAudio) {
                        formats.unshift({
                            itag: `${bestVideo.itag}+${bestAudio.itag}`,
                            qualityLabel: bestVideo.qualityLabel,
                            container: 'mp4',
                            hasVideo: true,
                            hasAudio: true,
                            format_note: `${bestVideo.qualityLabel} (En İyi Kalite Video + Ses)`,
                            filesize: 'Otomatik'
                        });
                    }
                    
                    // En iyi otomatik kalite
                    formats.unshift({
                        itag: 'best',
                        qualityLabel: 'Otomatik',
                        container: 'mp4',
                        hasVideo: true,
                        hasAudio: true,
                        format_note: 'En İyi Kalite (Otomatik)',
                        filesize: 'Otomatik'
                    });
                }
                
                // Formatları kaliteye göre sırala
                formats.sort((a, b) => {
                    // Öncelik sırası: 1. Video+Ses, 2. Sadece Video, 3. Sadece Ses
                    const typeOrder = (format) => {
                        if (format.hasVideo && format.hasAudio) return 0;
                        if (format.hasVideo) return 1;
                        if (format.hasAudio) return 2;
                        return 3;
                    };
                    
                    const orderA = typeOrder(a);
                    const orderB = typeOrder(b);
                    
                    if (orderA !== orderB) return orderA - orderB;
                    
                    // Aynı tiptekiler için çözünürlüğe göre sırala
                    const heightA = a.qualityLabel.includes('p') ? parseInt(a.qualityLabel) : 0;
                    const heightB = b.qualityLabel.includes('p') ? parseInt(b.qualityLabel) : 0;
                    return heightB - heightA;
                });
                
                console.log(`${formats.length} adet format bulundu.`);
                resolve({
                    title: title,
                    thumbnailUrl: thumbnailUrl,
                    formats: formats
                });
                
            } catch (parseError) {
                console.error('Format çıktısı işleme hatası:', parseError);
                fetchBasicInfo(url, userAgent, resolve, reject);
            }
        });
    });
}

// Temel video bilgilerini getiren yardımcı fonksiyon
function fetchBasicInfo(url, userAgent, resolve, reject) {
    console.log('Temel video bilgileri alınıyor...');
    
    // YouTube video ID'sini URL'den çıkart
    const videoId = extractVideoId(url);
    if (!videoId) {
        return reject(new Error('Geçersiz YouTube URL'));
    }
    
    fetch(`https://www.youtube.com/oembed?url=${url}&format=json`, {
        headers: { 'User-Agent': userAgent }
    })
    .then(res => res.json())
    .then(data => {
        const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
        const formats = [
            // Temel format seçenekleri
            {
                itag: 'best',
                qualityLabel: 'En İyi Kalite',
                container: 'mp4',
                hasVideo: true,
                hasAudio: true,
                format_note: 'En İyi Kalite (Otomatik)',
                filesize: 'Otomatik'
            },
            {
                itag: '22',
                qualityLabel: '720p',
                container: 'mp4',
                hasVideo: true,
                hasAudio: true,
                format_note: 'HD Video + Ses',
                filesize: 'Otomatik'
            },
            {
                itag: '18',
                qualityLabel: '360p',
                container: 'mp4',
                hasVideo: true,
                hasAudio: true,
                format_note: 'Orta Kalite Video + Ses',
                filesize: 'Otomatik'
            }
        ];
        
        resolve({
            title: data.title || `YouTube Video (${videoId})`,
            thumbnailUrl: thumbnailUrl,
            formats: formats
        });
    })
    .catch(err => {
        console.error('Video bilgileri alınamadı:', err);
        
        // En azından birkaç temel formatı göster
        resolve({
            title: `YouTube Video (${videoId})`,
            thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
            formats: [
                {
                    itag: 'best',
                    qualityLabel: 'En İyi Kalite',
                    container: 'mp4',
                    hasVideo: true,
                    hasAudio: true,
                    format_note: 'En İyi Kalite (Otomatik)',
                    filesize: 'Otomatik'
                },
                {
                    itag: '22',
                    qualityLabel: '720p',
                    container: 'mp4',
                    hasVideo: true,
                    hasAudio: true,
                    format_note: 'HD Video + Ses',
                    filesize: 'Otomatik'
                }
            ]
        });
    });
}

// Video indirme fonksiyonu
async function downloadVideo(videoUrl, videoId, itag, hasVideo, hasAudio) {
    return new Promise(async (resolve, reject) => {
        try {
            // İndirme işleminin başlamadan önce formatı belirlemeye çalışalım
            const ytdlpPath = process.env.NODE_ENV === 'production' ? '/usr/local/bin/yt-dlp' : path.join(__dirname, 'bin', 'yt-dlp.exe');
            // Tarayıcı bilgisi (user-agent) ekle
            const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
            
            // Format bilgilerini al
            try {
                const formatCmd = process.env.NODE_ENV === 'production'
                    ? `${ytdlpPath} -F "${videoUrl}" --user-agent "${userAgent}" --no-check-certificate`
                    : `"${ytdlpPath}" -F "${videoUrl}" --user-agent "${userAgent}" --no-check-certificate`;

                const formatOutput = await new Promise((resolveFormat, rejectFormat) => {
                    exec(formatCmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                        if (error) {
                            rejectFormat(error);
                            return;
                        }
                        resolveFormat(stdout);
                    });
                });
                
                // Seçilen format ID'sini formatlar listesinde bul
                const formatLines = formatOutput.split('\n');
                let outputExt = 'mp4'; // Varsayılan uzantı
                for (const line of formatLines) {
                    if (line.includes(itag)) {
                        // Format satırında uzantıyı tespit et
                        const extMatch = line.match(/\b(mp4|webm|m4a|opus|ogg)\b/i);
                        if (extMatch) {
                            outputExt = extMatch[0].toLowerCase();
                            console.log(`Format için uzantı tespit edildi: ${outputExt}`);
                        }
                        break;
                    }
                }
                
                // Çıktı dosyasını formatla benzersiz bir şekilde adlandır
                const outputFile = path.join(downloadDir, `${videoId}_${itag}.${outputExt}`);
                console.log(`Çıktı dosyası: ${outputFile}`);
                
                // Eğer itag "best" ise, en iyi kaliteyi seçelim
                let formatOption;
                if (itag === 'best') {
                    formatOption = `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"`;
                } else if (itag && itag.includes('+')) {
                    // İki format birleştirilecek (örn: 313+251)
                    formatOption = `-f "${itag.replace('+', '+')}"`;
                } else {
                    // İtag değerini doğrudan kullan
                    formatOption = itag ? `-f "${itag}"` : `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"`;
                }
                
                // MP4 formatına dönüştürme parametresi ve ses+video birleştirme için gerekli seçenekler
                const mergeParam = '--merge-output-format mp4';
                
                // Çıktı uzantısını MP4 olarak ayarla
                progressTracker[videoId].outputFile = `${videoId}_${itag}.mp4`;
                
                // yt-dlp ile indirme komutunu güncelle - Production ortamında farklı komut kullanacak
                let command;
                if (process.env.NODE_ENV === 'production') {
                    // Render deployment için doğru yolu kullan
                    const ytdlpProductionPath = '/usr/local/bin/yt-dlp';
                    command = `${ytdlpProductionPath} ${formatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir ${mergeParam}`;
                } else {
                    command = `"${ytdlpPath}" ${formatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir ${mergeParam}`;
                }
                
                console.log('İndirme komutu çalıştırılıyor:', command);
                
                // Komutu çalıştır
                const childProcess = spawn(command, { shell: true });
                
                let lastProgress = 0;
                let progressRegex = /(\d+\.\d+)%/;
                
                childProcess.stdout.on('data', (data) => {
                    const output = data.toString();
                    console.log('İndirme çıktısı:', output);
                    
                    // Önce videoId'nin progressTracker'da hala mevcut olup olmadığını kontrol et
                    if (!progressTracker[videoId]) {
                        console.log(`İlerleme takibi zaten silinmiş (${videoId}), çıktı yoksayılıyor`);
                        return;
                    }
                    
                    // İlerleme yüzdesini tespit et
                    const match = progressRegex.exec(output);
                    if (match && match[1]) {
                        const progress = parseFloat(match[1]) / 100;
                        if (progress > lastProgress) {
                            lastProgress = progress;
                            progressTracker[videoId].progress = progress;
                            progressTracker[videoId].status = `İndiriliyor... %${Math.round(progress * 100)}`;
                        }
                    }
                });
                
                childProcess.stderr.on('data', (data) => {
                    const error = data.toString();
                    console.error('İndirme hatası:', error);
                    
                    // Önce videoId'nin progressTracker'da hala mevcut olup olmadığını kontrol et
                    if (!progressTracker[videoId]) {
                        console.log(`İlerleme takibi zaten silinmiş (${videoId}), hata çıktısı yoksayılıyor`);
                        return;
                    }
                    
                    progressTracker[videoId].status = `İndirme devam ediyor... (Hata çıktısı: ${error.split('\n')[0]})`;
                    
                    // Yine de ilerleme bilgisi olabilir
                    const match = progressRegex.exec(error);
                    if (match && match[1]) {
                        const progress = parseFloat(match[1]) / 100;
                        if (progress > lastProgress) {
                            lastProgress = progress;
                            progressTracker[videoId].progress = progress;
                        }
                    }
                });
                
                // Bu çıkış kodları için yine de başarılı kabul et (bazı durumlarda 1 dönebilir ama dosya başarıyla indirilebilir)
                const successCodes = [0, 1];

                childProcess.on('close', (code) => {
                    console.log(`İndirme işlemi tamamlandı. Çıkış kodu: ${code}`);
                    
                    // Biraz bekle - bazı durumlarda dosyanın yazılması veya birleştirilmesi için ek süre gerekebilir
                    setTimeout(() => {
                        try {
                            // İndirme sırasında oluşturulan tüm dosyaları kontrol et
                            const downloadedFiles = fs.readdirSync(downloadDir)
                                .filter(file => file.startsWith(`${videoId}_${itag}`))
                                .map(file => path.join(downloadDir, file));
                            
                            console.log(`Bulunan indirilen dosyalar:`, downloadedFiles);
                            
                            if (downloadedFiles.length > 0) {
                                // En büyük dosyayı bul (bu muhtemelen ana video dosyasıdır)
                                let largestFile = null;
                                let largestSize = 0;
                                
                                for (const file of downloadedFiles) {
                                    const stats = fs.statSync(file);
                                    if (stats.size > largestSize) {
                                        largestSize = stats.size;
                                        largestFile = file;
                                    }
                                }
                                
                                if (largestFile && largestSize > 0) {
                                    const actualFilename = path.basename(largestFile);
                                    progressTracker[videoId].progress = 1;
                                    progressTracker[videoId].status = 'İndirme tamamlandı!';
                                    progressTracker[videoId].complete = true;
                                    progressTracker[videoId].outputFile = actualFilename;
                                    
                                    console.log(`Video başarıyla indirildi: ${largestFile} (${Math.round(largestSize / (1024*1024))} MB)`);
                                    resolve(actualFilename);
                                    return;
                                }
                            }
                            
                            // Hiç dosya bulunamadı veya boş dosya - tekrar deneme yapalım
                            console.error(`Geçerli bir dosya bulunamadı. Yeniden deneme yapılıyor...`);
                            
                            // Hata durumunda tekrar indirmeyi dene - doğrudan yine yt-dlp ile deneyelim
                            progressTracker[videoId].status = 'Video formatı değiştirilerek tekrar indiriliyor...';
                            
                            // Daha basit bir format deneyelim
                            let simpleFormatOption;
                            if (itag === 'best') {
                                simpleFormatOption = `-f bestvideo+bestaudio/best`;
                            } else if (itag && itag.includes('+')) {
                                // İki formatı zaten denemiş, tekrar denemek için sadece birinci formatı al
                                const firstFormat = itag.split('+')[0];
                                simpleFormatOption = `-f ${firstFormat}+bestaudio/best`;
                            } else {
                                simpleFormatOption = itag ? `-f ${itag}/best` : `-f bestvideo+bestaudio/best`;
                            }
                            
                            // Tekrar indirme için de MP4 birleştirme parametresini kaldıralım
                            const retryMergeParam = '--recode-video mp4';

                            // Yeni indirme komutu
                            const retryCommand = process.env.NODE_ENV === 'production'
                                ? `${ytdlpPath} ${simpleFormatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir --merge-output-format mp4`
                                : `"${ytdlpPath}" ${simpleFormatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir --merge-output-format mp4`;
                            
                            console.log('Tekrar indirme komutu çalıştırılıyor:', retryCommand);
                            
                            const retryProcess = spawn(retryCommand, { shell: true });
                            
                            retryProcess.stdout.on('data', (data) => {
                                const output = data.toString();
                                console.log('Tekrar indirme çıktısı:', output);
                                
                                // Önce videoId'nin progressTracker'da hala mevcut olup olmadığını kontrol et
                                if (!progressTracker[videoId]) {
                                    console.log(`İlerleme takibi zaten silinmiş (${videoId}), tekrar çıktısı yoksayılıyor`);
                                    return;
                                }
                                
                                const match = progressRegex.exec(output);
                                if (match && match[1]) {
                                    const progress = parseFloat(match[1]) / 100;
                                    if (progress > lastProgress) {
                                        lastProgress = progress;
                                        progressTracker[videoId].progress = progress;
                                        progressTracker[videoId].status = `Tekrar indiriliyor... %${Math.round(progress * 100)}`;
                                    }
                                }
                            });
                            
                            retryProcess.stderr.on('data', (data) => {
                                console.error('Tekrar indirme hatası:', data.toString());
                                
                                // Önce videoId'nin progressTracker'da hala mevcut olup olmadığını kontrol et
                                if (!progressTracker[videoId]) {
                                    console.log(`İlerleme takibi zaten silinmiş (${videoId}), tekrar hata çıktısı yoksayılıyor`);
                                    return;
                                }
                            });
                            
                            retryProcess.on('close', (retryCode) => {
                                console.log(`Tekrar indirme işlemi tamamlandı. Çıkış kodu: ${retryCode}`);
                                
                                // Dosya varlığını tekrar kontrol et - biraz bekleyerek
                                setTimeout(() => {
                                    try {
                                        // İndirme sırasında oluşturulan tüm dosyaları kontrol et (özellikle yüksek çözünürlüklü formatlar için)
                                        const downloadedFiles = fs.readdirSync(downloadDir)
                                            .filter(file => file.startsWith(`${videoId}_${itag}`))
                                            .map(file => path.join(downloadDir, file));
                                        
                                        console.log(`Bulunan indirilen dosyalar:`, downloadedFiles);
                                        
                                        if (downloadedFiles.length > 0) {
                                            // En büyük dosyayı bul (bu muhtemelen ana video dosyasıdır)
                                            let largestFile = null;
                                            let largestSize = 0;
                                            
                                            for (const file of downloadedFiles) {
                                                const stats = fs.statSync(file);
                                                if (stats.size > largestSize) {
                                                    largestSize = stats.size;
                                                    largestFile = file;
                                                }
                                            }
                                            
                                            if (largestFile && largestSize > 0) {
                                                const actualFilename = path.basename(largestFile);
                                                progressTracker[videoId].progress = 1;
                                                progressTracker[videoId].status = 'İndirme tamamlandı!';
                                                progressTracker[videoId].complete = true;
                                                progressTracker[videoId].outputFile = actualFilename;
                                                
                                                console.log(`Video başarıyla indirildi: ${largestFile} (${Math.round(largestSize / (1024*1024))} MB)`);
                                                resolve(actualFilename);
                                            } else {
                                                progressTracker[videoId].error = 'Video indirilemedi: Boş dosya.';
                                                console.error('Dosya boş: 0 byte');
                                                reject(new Error('İndirme başarısız: Boş dosya'));
                                            }
                                        } else {
                                            // Dosya yok - son çare olarak 22 formatını deneyelim
                                            console.error(`Dosya bulunamadı, son deneme olarak 22 formatını kullanıyoruz.`);
                                            
                                            // 22 formatı (720p MP4) ile son bir deneme yapalım - zaten MP4 olduğu için ek dönüşüm yapmıyoruz
                                            const lastOption = `-f 22/18/best`;
                                            const lastOutputFile = path.join(downloadDir, `${videoId}_backup`); // Uzantıyı koymuyoruz, orijinal uzantı kullanılacak
                                            
                                            const lastCommand = process.env.NODE_ENV === 'production'
                                                ? `${ytdlpPath} ${lastOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${lastOutputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir --merge-output-format mp4`
                                                : `"${ytdlpPath}" ${lastOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${lastOutputFile}" --force-overwrite --user-agent "${userAgent}" --no-cache-dir --merge-output-format mp4`;
                                            
                                            console.log('Son deneme komutu çalıştırılıyor:', lastCommand);
                                            
                                            try {
                                                // Senkron versiyonu kullanarak bekleyelim
                                                const { status } = require('child_process').spawnSync(lastCommand, { shell: true });
                                                
                                                if (status === 0 && fs.existsSync(lastOutputFile)) {
                                                    const lastFileSize = fs.statSync(lastOutputFile).size;
                                                    if (lastFileSize > 0) {
                                                        progressTracker[videoId].progress = 1;
                                                        progressTracker[videoId].status = 'İndirme tamamlandı! (Yedek format)';
                                                        progressTracker[videoId].complete = true;
                                                        progressTracker[videoId].outputFile = `${videoId}_backup`;
                                                        
                                                        console.log(`Video yedek formatla indirildi: ${lastOutputFile} (${Math.round(lastFileSize / (1024*1024))} MB)`);
                                                        resolve(`${videoId}_backup`);
                                                        return;
                                                    }
                                                }
                                                
                                                progressTracker[videoId].error = 'Video indirilemedi: Tüm format denemeleri başarısız.';
                                                reject(new Error('İndirme başarısız: Format bulunamadı'));
                                            } catch (lastError) {
                                                console.error('Son deneme hatası:', lastError);
                                                progressTracker[videoId].error = 'Video indirilemedi: Son deneme başarısız.';
                                                reject(new Error('İndirme başarısız: Son deneme hata verdi'));
                                            }
                                        }
                                    } catch (fsError) {
                                        console.error('Dosya kontrolü sırasında hata:', fsError);
                                        progressTracker[videoId].error = `Dosya kontrolü hatası: ${fsError.message}`;
                                        reject(new Error(`İndirme başarısız: ${fsError.message}`));
                                    }
                                }, 2000); // 2 saniye bekle
                            });
                        } catch (fsError) {
                            console.error('Dosya kontrolü sırasında hata:', fsError);
                            progressTracker[videoId].error = `Dosya kontrolü hatası: ${fsError.message}`;
                            reject(new Error(`İndirme başarısız: ${fsError.message}`));
                        }
                    }, 2000); // 2 saniye bekle
                });
            } catch (formatError) {
                console.error('Format bilgisi alınamadı:', formatError);
                reject(formatError);
            }
            
        } catch (error) {
            console.error('Video indirme hatası:', error);
            progressTracker[videoId].error = error.message;
            reject(error);
        }
    });
}

// Belirli bir port üzerinde sunucuyu başlatmayı deneyen fonksiyon
function startServer(port) {
    return new Promise((resolve, reject) => {
        server = http.createServer(app);
        
        // Bağlantı hatası durumunda
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${port} zaten kullanımda, başka bir port deneniyor...`);
                server.close();
                resolve(false);
            } else {
                reject(err);
            }
        });
        
        // Başarılı bağlantı durumunda
        server.on('listening', () => {
            console.log(`Sunucu http://localhost:${port} adresinde çalışıyor`);
            resolve(true);
        });
        
        server.listen(port);
    });
}

// Kullanılabilir bir port bulana kadar port numarasını artırarak devam eden fonksiyon
async function findAvailablePort() {
    let portAvailable = false;
    let attempts = 0;
    const maxAttempts = 10; // En fazla 10 port denemesi yapılacak
    
    while (!portAvailable && attempts < maxAttempts) {
        try {
            portAvailable = await startServer(PORT);
            if (!portAvailable) {
                PORT++;
                attempts++;
            }
        } catch (error) {
            console.error('Sunucu başlatma hatası:', error);
            PORT++;
            attempts++;
        }
    }
    
    if (!portAvailable) {
        console.error('Kullanılabilir port bulunamadı!');
        process.exit(1);
    }
    
    // Uygulama başlatıldığında tarayıcıda otomatik olarak açma işlemini kaldır
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor. Tarayıcınızdan bu adrese gidebilirsiniz.`);
    
    return PORT;
}

// Sunucuyu başlat
findAvailablePort();

// YouTube URL'sinden video ID'sini çıkarma
function extractVideoId(url) {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
}