from flask import Flask, render_template, request, send_file, redirect, url_for, flash, session
import os
import tempfile
import shutil
from pytube import YouTube
import logging
from datetime import datetime
import re

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'youtube-downloader-secret-key')
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024  # 1GB max-size

# Kayıt defteri yapılandırması
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# İndirme klasörünü oluştur
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def sanitize_filename(filename):
    # Dosya adındaki özel karakterleri kaldır
    return re.sub(r'[\\/*?:"<>|]', "", filename)

@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        youtube_url = request.form.get('youtube_url')
        if not youtube_url:
            flash('Lütfen geçerli bir YouTube URL\'si girin', 'danger')
            return redirect(url_for('index'))
        
        try:
            yt = YouTube(youtube_url)
            session['video_info'] = {
                'url': youtube_url,
                'title': yt.title,
                'thumbnail': yt.thumbnail_url,
                'author': yt.author,
                'length': yt.length
            }
            
            # Mevcut akışları al
            streams = []
            for stream in yt.streams.filter(progressive=True).order_by('resolution').desc():
                streams.append({
                    'itag': stream.itag,
                    'resolution': stream.resolution,
                    'fps': stream.fps,
                    'mime_type': stream.mime_type,
                    'size_mb': round(stream.filesize / (1024 * 1024), 2)
                })
            
            session['streams'] = streams
            return redirect(url_for('quality_selection'))
        except Exception as e:
            logger.error(f"Video yüklenirken hata: {str(e)}")
            flash(f'Video bilgilerini yüklerken hata oluştu: {str(e)}', 'danger')
            return redirect(url_for('index'))
    
    return render_template('index.html')

@app.route('/quality-selection', methods=['GET'])
def quality_selection():
    if 'video_info' not in session or 'streams' not in session:
        flash('Lütfen önce bir YouTube video URL\'si girin', 'warning')
        return redirect(url_for('index'))
    
    return render_template('quality.html', video_info=session['video_info'], streams=session['streams'])

@app.route('/download', methods=['POST'])
def download_video():
    if 'video_info' not in session:
        flash('Video bilgileri bulunamadı', 'danger')
        return redirect(url_for('index'))
    
    itag = request.form.get('itag')
    if not itag:
        flash('Kalite seçimi bulunamadı', 'danger')
        return redirect(url_for('quality_selection'))
    
    try:
        yt = YouTube(session['video_info']['url'])
        stream = yt.streams.get_by_itag(int(itag))
        
        if not stream:
            flash('Seçilen kalite bulunamadı', 'danger')
            return redirect(url_for('quality_selection'))
        
        # Güvenli bir dosya adı oluştur
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        safe_title = sanitize_filename(yt.title)
        filename = f"{safe_title}_{stream.resolution}_{timestamp}.mp4"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Videoyu indir
        stream.download(output_path=app.config['UPLOAD_FOLDER'], filename=filename)
        
        # Dosya yolu HTTP isteği için kullanılabilir hale getir
        download_path = os.path.join('downloads', filename)
        session['download_file'] = download_path
        
        return redirect(url_for('complete'))
    except Exception as e:
        logger.error(f"İndirme hatası: {str(e)}")
        flash(f'Video indirilirken hata oluştu: {str(e)}', 'danger')
        return redirect(url_for('quality_selection'))

@app.route('/complete')
def complete():
    if 'download_file' not in session:
        flash('İndirme bilgisi bulunamadı', 'warning')
        return redirect(url_for('index'))
    
    download_file = session['download_file']
    return render_template('complete.html', download_file=download_file)

@app.route('/downloads/<path:filename>')
def download_file(filename):
    return send_file(os.path.join(app.config['UPLOAD_FOLDER'], filename), as_attachment=True)

@app.route('/clear')
def clear_session():
    session.clear()
    return redirect(url_for('index'))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True) 