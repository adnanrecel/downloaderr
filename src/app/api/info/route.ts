import { NextRequest, NextResponse } from 'next/server';
import ytdl from 'ytdl-core';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');

    if (!url) {
      return NextResponse.json({ error: 'URL parametresi gereklidir' }, { status: 400 });
    }

    if (!ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Geçersiz YouTube URL\'si' }, { status: 400 });
    }

    const info = await ytdl.getInfo(url);
    
    const formats = info.formats.map(format => ({
      itag: format.itag,
      qualityLabel: format.qualityLabel || 'Yalnızca Ses',
      mimeType: format.mimeType,
      hasVideo: format.hasVideo,
      hasAudio: format.hasAudio,
      container: format.container,
      contentLength: format.contentLength,
      bitrate: format.bitrate,
    }));

    return NextResponse.json({
      title: info.videoDetails.title,
      author: info.videoDetails.author.name,
      lengthSeconds: info.videoDetails.lengthSeconds,
      viewCount: info.videoDetails.viewCount,
      thumbnails: info.videoDetails.thumbnails,
      formats: formats.filter(format => format.hasVideo && format.hasAudio)
    });
  } catch (error) {
    console.error('Video bilgisi alınırken hata oluştu:', error);
    return NextResponse.json({ error: 'Video bilgisi alınamadı' }, { status: 500 });
  }
} 