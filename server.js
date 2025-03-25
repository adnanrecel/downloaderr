const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fetch = require('node-fetch');
const http = require('http');
const open = require('open');

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
        downloadVideo(videoUrl, videoId, itag, hasVideo, hasAudio);
        
        return res.json({ message: 'İndirme başlatıldı', videoId });
        
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
                setTimeout(() => {
                    delete progressTracker[videoId];
                }, 60000); // 1 dakika sonra temizle
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
    if (contentTypes[fileExt]) {
        res.setHeader('Content-Type', contentTypes[fileExt]);
    }
    
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
        // yt-dlp komutu ile video bilgilerini JSON formatında almak
        // Production ortamında yt-dlp doğrudan binary kullanılabilir olacak
        const ytdlpPath = process.env.NODE_ENV === 'production' ? '/usr/local/bin/yt-dlp' : path.join(__dirname, 'bin', 'yt-dlp.exe');
        const command = process.env.NODE_ENV === 'production' 
            ? `${ytdlpPath} "${url}" --dump-json --no-warnings --no-call-home --skip-download`
            : `"${ytdlpPath}" "${url}" --dump-json --no-warnings --no-call-home --skip-download`;
        
        console.log("Kullanılan komut:", command);
        
        exec(command, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error('yt-dlp JSON bilgi alma hatası:', error);
                // Hata durumunda YouTube'un web API'sini kullanarak bilgileri almayı deneyelim
                fetch(`https://www.youtube.com/oembed?url=${url}&format=json`)
                    .then(res => res.json())
                    .then(data => {
                        // Çok çeşitli format bilgilerini oluştur
                        const formats = [
                            // Video + Ses formatları (MP4)
                            {
                                itag: 'best',
                                qualityLabel: 'En iyi kalite (1080p)',
                                container: 'mp4',
                                hasVideo: true,
                                hasAudio: true,
                                format_note: 'Full HD Video + Ses'
                            },
                            {
                                itag: '22',
                                qualityLabel: '720p',
                                container: 'mp4',
                                hasVideo: true,
                                hasAudio: true,
                                format_note: 'HD Video + Ses'
                            },
                            {
                                itag: '18',
                                qualityLabel: '360p',
                                container: 'mp4',
                                hasVideo: true,
                                hasAudio: true,
                                format_note: 'Orta Kalite Video + Ses'
                            },
                            // Sadece video formatları
                            {
                                itag: '137',
                                qualityLabel: '1080p',
                                container: 'mp4',
                                hasVideo: true,
                                hasAudio: false,
                                format_note: 'Full HD (Sadece Video)'
                            },
                            {
                                itag: '136',
                                qualityLabel: '720p',
                                container: 'mp4',
                                hasVideo: true,
                                hasAudio: false,
                                format_note: 'HD (Sadece Video)'
                            },
                            // Sadece ses formatları
                            {
                                itag: '140',
                                qualityLabel: '128kbps',
                                container: 'm4a',
                                hasVideo: false,
                                hasAudio: true,
                                format_note: 'M4A Audio (Sadece Ses)'
                            },
                            {
                                itag: '251',
                                qualityLabel: '160kbps',
                                container: 'webm',
                                hasVideo: false,
                                hasAudio: true,
                                format_note: 'Opus Audio (Sadece Ses)'
                            },
                            // Diğer formatlar
                            {
                                itag: '43',
                                qualityLabel: '360p',
                                container: 'webm',
                                hasVideo: true,
                                hasAudio: true,
                                format_note: 'WebM (Video + Ses)'
                            }
                        ];
                        
                        resolve({
                            title: data.title,
                            thumbnailUrl: data.thumbnail_url,
                            formats: formats
                        });
                    })
                    .catch(err => {
                        console.error('Web API ile bilgi alma hatası:', err);
                        reject(new Error('Video bilgileri alınamadı. Lütfen daha sonra tekrar deneyin.'));
                    });
                return;
            }
            
            try {
                processVideoInfo(stdout, resolve, reject);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

// JSON formatındaki video bilgilerini işleyen fonksiyon
function processVideoInfo(jsonData, resolve, reject) {
    try {
        const info = JSON.parse(jsonData);
        
        // Thumbnail URL'i bul
        const thumbnail = info.thumbnails ? 
            info.thumbnails[info.thumbnails.length - 1]?.url : 
            `https://i.ytimg.com/vi/${info.id}/maxresdefault.jpg`;
        
        // Format bilgilerini düzenle - tüm formatları al
        const formats = info.formats
            .map(format => {
                const hasVideo = format.vcodec !== 'none';
                const hasAudio = format.acodec !== 'none';
                
                let qualityLabel = '';
                if (hasVideo && format.height) {
                    qualityLabel = `${format.height}p`;
                    if (format.fps) qualityLabel += ` ${format.fps}fps`;
                } else if (hasAudio && format.abr) {
                    qualityLabel = `${Math.round(format.abr)}kbps`;
                } else {
                    qualityLabel = format.format_note || 'Unknown';
                }
                
                return {
                    itag: format.format_id,
                    qualityLabel: qualityLabel,
                    container: format.ext || 'unknown',
                    hasVideo: hasVideo,
                    hasAudio: hasAudio,
                    audioBitrate: format.abr || 0,
                    contentLength: format.filesize || 0,
                    fps: format.fps || 0,
                    format_note: format.format_note || '',
                    resolution: format.resolution || '',
                    filesize: format.filesize ? Math.round(format.filesize / (1024 * 1024)) + ' MB' : 'Bilinmiyor',
                    vcodec: format.vcodec || 'none',
                    acodec: format.acodec || 'none'
                };
            })
            // Önce video+ses içerenleri, sonra sadece video, en son sadece ses formatlarını göster
            .sort((a, b) => {
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
                const heightA = parseInt(a.qualityLabel) || 0;
                const heightB = parseInt(b.qualityLabel) || 0;
                return heightB - heightA;
            });
        
        resolve({
            title: info.title,
            thumbnailUrl: thumbnail,
            formats
        });
        
    } catch (error) {
        console.error('Video bilgilerini işleme hatası:', error);
        reject(new Error('Video bilgileri işlenemedi.'));
    }
}

// Video indirme fonksiyonu
async function downloadVideo(videoUrl, videoId, itag, hasVideo, hasAudio) {
    try {
        // İndirme işleminin başlamadan önce formatı belirlemeye çalışalım
        const ytdlpPath = process.env.NODE_ENV === 'production' ? '/usr/local/bin/yt-dlp' : path.join(__dirname, 'bin', 'yt-dlp.exe');
        
        // Format bilgilerini al
        try {
            const formatCmd = process.env.NODE_ENV === 'production'
                ? `${ytdlpPath} -F "${videoUrl}"`
                : `"${ytdlpPath}" -F "${videoUrl}"`;

            const formatOutput = await new Promise((resolve, reject) => {
                exec(formatCmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(stdout);
                });
            });
            
            // Seçilen format ID'sini formatlar listesinde bul
            const formatLines = formatOutput.split('\n');
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
        } catch (formatError) {
            console.error('Format bilgisi alınamadı:', formatError);
            // Varsayılan MP4 uzantısını kullanacağız
        }
        
        // MP4 her zaman daha iyi çalıştığı için outputExt'i her zaman mp4 yapıyoruz
        outputExt = 'mp4';
        
        // Çıktı dosyasını formatla benzersiz bir şekilde adlandır
        const outputFile = path.join(downloadDir, `${videoId}_${itag}.${outputExt}`);
        console.log(`Çıktı dosyası: ${outputFile}`);
        
        // Eğer itag "best" ise, en iyi kaliteyi seçelim
        let formatOption;
        if (itag === 'best') {
            formatOption = `-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
        } else {
            formatOption = itag ? `-f ${itag}` : `-f bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best`;
        }
        
        // yt-dlp ile indirme komutunu güncelle - Production ortamında farklı komut kullanacak
        let command;
        if (process.env.NODE_ENV === 'production') {
            command = `/usr/local/bin/yt-dlp ${formatOption} --no-warnings --no-check-certificate --prefer-free-formats "${videoUrl}" -o "${outputFile}" --force-overwrite`;
        } else {
            command = `"${ytdlpPath}" ${formatOption} --no-warnings --no-check-certificate --prefer-free-formats "${videoUrl}" -o "${outputFile}" --force-overwrite`;
        }
        
        console.log('İndirme komutu çalıştırılıyor:', command);
        
        // Komutu çalıştır
        const process = spawn(command, { shell: true });
        
        let lastProgress = 0;
        let progressRegex = /(\d+\.\d+)%/;
        
        process.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('İndirme çıktısı:', output);
            
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
        
        process.stderr.on('data', (data) => {
            const error = data.toString();
            console.error('İndirme hatası:', error);
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
        
        process.on('close', (code) => {
            // İndirilen dosyayı kontrol et
            fs.access(outputFile, fs.constants.F_OK, (err) => {
                if (code === 0 && !err) {
                    // Dosya başarıyla oluşturuldu ve kod 0 ile tamamlandı
                    progressTracker[videoId].progress = 1;
                    progressTracker[videoId].status = 'İndirme tamamlandı!';
                    progressTracker[videoId].complete = true;
                    progressTracker[videoId].outputFile = `${videoId}_${itag}.mp4`;
                    
                    console.log(`Video başarıyla indirildi: ${outputFile}`);
                } else {
                    // Başarısız - youtube-dl ile dene
                    console.error(`yt-dlp çıkış kodu ${code} ile tamamlandı veya dosya bulunamadı. youtube-dl deneniyor...`);
                    
                    // youtube-dl ile alternatif indirme komutu - ffmpeg olmadığı için dönüştürme kaldırıldı
                    const altCommand = process.env.NODE_ENV === 'production'
                        ? `${ytdlpPath} ${formatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite`
                        : `youtube-dl ${formatOption} --no-warnings --no-check-certificate "${videoUrl}" -o "${outputFile}" --force-overwrite`;
                    
                    const altProcess = spawn(altCommand, { shell: true });
                    
                    altProcess.stdout.on('data', (data) => {
                        const output = data.toString();
                        console.log('youtube-dl çıktısı:', output);
                        
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
                    
                    altProcess.stderr.on('data', (data) => {
                        console.error('youtube-dl hatası:', data.toString());
                    });
                    
                    altProcess.on('close', (altCode) => {
                        if (altCode === 0) {
                            progressTracker[videoId].progress = 1;
                            progressTracker[videoId].status = 'İndirme tamamlandı!';
                            progressTracker[videoId].complete = true;
                            progressTracker[videoId].outputFile = `${videoId}_${itag}.mp4`;
                            
                            console.log(`Video başarıyla indirildi: ${outputFile}`);
                        } else {
                            progressTracker[videoId].error = 'Video indirilemedi.';
                            console.error(`youtube-dl çıkış kodu ${altCode} ile tamamlandı.`);
                        }
                    });
                }
            });
        });
        
    } catch (error) {
        console.error('Video indirme hatası:', error);
        progressTracker[videoId].error = error.message;
    }
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
    
    // Uygulama başlatıldığında tarayıcıda otomatik olarak aç
    try {
        open(`http://localhost:${PORT}`);
        console.log('Tarayıcı otomatik olarak açıldı.');
    } catch (err) {
        console.log('Tarayıcı otomatik olarak açılamadı. Lütfen manuel olarak http://localhost:' + PORT + ' adresini ziyaret edin.');
    }
    
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