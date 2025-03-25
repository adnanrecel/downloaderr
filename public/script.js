document.addEventListener('DOMContentLoaded', () => {
    const videoUrlInput = document.getElementById('videoUrl');
    const fetchBtn = document.getElementById('fetchBtn');
    const videoInfo = document.getElementById('videoInfo');
    const thumbnail = document.getElementById('thumbnail');
    const videoTitle = document.getElementById('videoTitle');
    const formatList = document.getElementById('formatList');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadStatus = document.getElementById('downloadStatus');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const downloadMessage = document.getElementById('downloadMessage');

    let selectedFormat = null;
    let videoId = null;

    // Video bilgilerini getir
    fetchBtn.addEventListener('click', async () => {
        const url = videoUrlInput.value.trim();
        
        if (!url) {
            alert('Lütfen bir YouTube URL\'si girin');
            return;
        }

        try {
            // URL'den video ID'sini çıkar
            videoId = extractVideoId(url);
            if (!videoId) {
                throw new Error('Geçersiz YouTube URL\'si');
            }

            fetchBtn.disabled = true;
            fetchBtn.textContent = 'Bilgiler Getiriliyor...';

            const response = await fetch(`/api/video-info?url=${encodeURIComponent(url)}`);
            
            if (!response.ok) {
                throw new Error('Video bilgileri alınamadı');
            }

            const data = await response.json();
            
            // Video bilgilerini göster
            thumbnail.src = data.thumbnailUrl;
            videoTitle.textContent = data.title;
            
            // Format listesini temizle
            formatList.innerHTML = '';
            
            // Formatları listele
            data.formats.forEach(format => {
                const formatItem = document.createElement('div');
                formatItem.className = 'format-item';
                formatItem.dataset.itag = format.itag;
                
                // Format türüne göre renk sınıfı ekle
                if (format.hasVideo && format.hasAudio) {
                    formatItem.classList.add('format-complete');
                } else if (format.hasVideo) {
                    formatItem.classList.add('format-video-only');
                } else if (format.hasAudio) {
                    formatItem.classList.add('format-audio-only');
                }
                
                // Format bilgilerini zengin bir şekilde göster
                const formatQuality = document.createElement('div');
                formatQuality.className = 'format-quality';
                formatQuality.textContent = format.qualityLabel;
                
                const formatDetails = document.createElement('div');
                formatDetails.className = 'format-details';
                
                let detailsText = `${format.container.toUpperCase()}`;
                if (format.format_note) {
                    detailsText += ` - ${format.format_note}`;
                }
                if (format.filesize) {
                    detailsText += ` (${format.filesize})`;
                }
                
                formatDetails.textContent = detailsText;
                
                formatItem.appendChild(formatQuality);
                formatItem.appendChild(formatDetails);
                
                formatItem.addEventListener('click', () => {
                    // Önceki seçimi kaldır
                    document.querySelectorAll('.format-item.selected').forEach(item => {
                        item.classList.remove('selected');
                    });
                    
                    // Yeni seçimi işaretle
                    formatItem.classList.add('selected');
                    selectedFormat = format;
                });
                
                formatList.appendChild(formatItem);
            });
            
            // Video bilgilerini göster
            videoInfo.classList.remove('hidden');
            
        } catch (error) {
            alert('Hata: ' + error.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.textContent = 'Bilgileri Getir';
        }
    });

    // İndirme işlemini başlat
    downloadBtn.addEventListener('click', async () => {
        if (!selectedFormat) {
            alert('Lütfen bir format seçin');
            return;
        }

        try {
            downloadBtn.disabled = true;
            downloadStatus.classList.remove('hidden');
            progressBar.style.width = '0%';
            progressText.textContent = '%0';
            downloadMessage.textContent = 'İndiriliyor...';

            const response = await fetch('/api/download', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    videoId,
                    itag: selectedFormat.itag,
                    hasVideo: selectedFormat.hasVideo,
                    hasAudio: selectedFormat.hasAudio
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'İndirme sırasında bir hata oluştu');
            }

            // SSE (Server-Sent Events) ile ilerleme durumunu izle
            const progressSource = new EventSource(`/api/progress/${videoId}`);
            
            progressSource.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                if (data.progress) {
                    const percent = Math.round(data.progress * 100);
                    progressBar.style.width = `${percent}%`;
                    progressText.textContent = `%${percent}`;
                }
                
                if (data.status) {
                    downloadMessage.textContent = data.status;
                }
                
                if (data.complete) {
                    progressSource.close();
                    progressBar.style.width = '100%';
                    progressText.textContent = '%100';
                    downloadMessage.textContent = 'İndirme tamamlandı! Video işleniyor...';
                    
                    // İndirme tamamlandığında, MP4 dosyasını indir
                    if (data.outputFile) {
                        setTimeout(() => {
                            try {
                                // Doğrudan indirme bağlantısını oluştur ve tıkla
                                const videoUrl = `/download/${encodeURIComponent(data.outputFile)}`;
                                
                                // Mevcut sayfada indirme işlemini başlat
                                window.location.href = videoUrl;
                                
                                downloadMessage.textContent = 'İndirme başlatıldı! Dosya bilgisayarınıza kaydediliyor...';
                                
                                // İşlem tamamlandıktan sonra düğmeyi etkinleştir
                                setTimeout(() => {
                                    downloadBtn.disabled = false;
                                }, 3000);
                            } catch (err) {
                                console.error('İndirme hatası:', err);
                                downloadMessage.textContent = 'İndirme sırasında bir hata oluştu! Lütfen tekrar deneyin.';
                                downloadBtn.disabled = false;
                            }
                        }, 2000);
                    }
                }
                
                if (data.error) {
                    progressSource.close();
                    downloadMessage.textContent = `Hata: ${data.error}`;
                    downloadBtn.disabled = false;
                }
            };
            
            progressSource.onerror = () => {
                progressSource.close();
                downloadMessage.textContent = 'Sunucu bağlantısı kesildi.';
                downloadBtn.disabled = false;
            };
            
        } catch (error) {
            alert('Hata: ' + error.message);
            downloadBtn.disabled = false;
            downloadMessage.textContent = `Hata: ${error.message}`;
        }
    });

    // YouTube URL'sinden video ID'sini çıkarma
    function extractVideoId(url) {
        const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[7].length === 11) ? match[7] : null;
    }
}); 