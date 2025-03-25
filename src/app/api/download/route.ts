import { NextRequest, NextResponse } from 'next/server';
import ytdl from 'ytdl-core';
import { Readable } from 'stream';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get('url');
    const itag = searchParams.get('itag');

    if (!url || !itag) {
      return NextResponse.json({ error: 'URL ve itag parametreleri gereklidir' }, { status: 400 });
    }

    if (!ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Geçersiz YouTube URL\'si' }, { status: 400 });
    }

    const info = await ytdl.getInfo(url);
    const videoTitle = info.videoDetails.title.replace(/[^\w\s]/gi, '');
    
    const videoStream = ytdl(url, {
      quality: itag
    });

    // Stream'i ReadableStream'e çevirme
    const readable = Readable.fromWeb(videoStream as any);
    
    // Buffer içeriğine çevirme
    const chunks: Uint8Array[] = [];
    for await (const chunk of readable) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${videoTitle}.mp4"`);
    headers.set('Content-Type', 'video/mp4');
    headers.set('Content-Length', buffer.length.toString());

    return new NextResponse(buffer, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('Video indirme sırasında hata oluştu:', error);
    return NextResponse.json({ error: 'Video indirilemiyor' }, { status: 500 });
  }
} 