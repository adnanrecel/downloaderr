'use client';

import { useState } from 'react';
import { FaYoutube, FaDownload, FaSearch } from 'react-icons/fa';
import Image from 'next/image';

interface VideoFormat {
  itag: string;
  qualityLabel: string;
  mimeType: string;
  hasVideo: boolean;
  hasAudio: boolean;
  container: string;
  contentLength?: string;
  bitrate: number;
}

interface VideoInfo {
  title: string;
  author: string;
  lengthSeconds: string;
  viewCount: string;
  thumbnails: { url: string; width: number; height: number }[];
  formats: VideoFormat[];
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!url) {
      setError('Lütfen bir YouTube URL\'si girin');
      return;
    }

    setLoading(true);
    setError('');
    setVideoInfo(null);

    try {
      const response = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Video bilgisi alınamadı');
      }
      
      const data = await response.json();
      setVideoInfo(data);
    } catch (err: any) {
      setError(err.message || 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (itag: string) => {
    if (!url) return;
    
    try {
      window.open(`/api/download?url=${encodeURIComponent(url)}&itag=${itag}`, '_blank');
    } catch (err: any) {
      setError(err.message || 'İndirme sırasında bir hata oluştu');
    }
  };

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return 'Bilinmiyor';
    
    const sizeInMB = parseInt(bytes) / (1024 * 1024);
    return sizeInMB.toFixed(2) + ' MB';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-indigo-950 py-10 px-4">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-xl overflow-hidden">
        <div className="p-8">
          <div className="flex items-center justify-center mb-8">
            <FaYoutube className="text-5xl text-red-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">YouTube Video İndirici</h1>
          </div>
          
          <form onSubmit={handleSubmit} className="mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-grow">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <FaYoutube className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="YouTube video URL'sini yapıştırın"
                  className="pl-10 block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-3 px-4 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-6 rounded-lg font-medium transition-colors disabled:opacity-70"
              >
                {loading ? (
                  <span className="animate-spin inline-block h-5 w-5 border-t-2 border-white rounded-full mr-2"></span>
                ) : (
                  <FaSearch className="mr-2" />
                )}
                {loading ? 'Yükleniyor...' : 'Arama'}
              </button>
            </div>
          </form>
          
          {error && (
            <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 mb-6 rounded-lg">
              {error}
            </div>
          )}

          {videoInfo && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="sm:w-1/3">
                  <div className="relative rounded-lg overflow-hidden aspect-video shadow-md">
                    <Image 
                      src={videoInfo.thumbnails[videoInfo.thumbnails.length - 1]?.url || '/placeholder.png'} 
                      alt={videoInfo.title}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover"
                    />
                  </div>
                </div>
                <div className="sm:w-2/3 space-y-4">
                  <h2 className="text-xl font-semibold text-gray-800 dark:text-white line-clamp-2">
                    {videoInfo.title}
                  </h2>
                  <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
                    <p><span className="font-medium">Kanal:</span> {videoInfo.author}</p>
                    <p><span className="font-medium">Süre:</span> {Math.floor(parseInt(videoInfo.lengthSeconds) / 60)}:{(parseInt(videoInfo.lengthSeconds) % 60).toString().padStart(2, '0')}</p>
                    <p><span className="font-medium">İzlenme:</span> {parseInt(videoInfo.viewCount).toLocaleString('tr-TR')}</p>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-white">
                  İndirme Seçenekleri
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <thead className="bg-gray-100 dark:bg-gray-700">
                      <tr>
                        <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Kalite</th>
                        <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Dosya Tipi</th>
                        <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Boyut</th>
                        <th className="py-3 px-4 text-left text-sm font-medium text-gray-700 dark:text-gray-200">İşlem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {videoInfo.formats.map((format) => (
                        <tr key={format.itag} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                          <td className="py-3 px-4 text-sm text-gray-700 dark:text-gray-200">
                            {format.qualityLabel}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-700 dark:text-gray-200">
                            {format.container.toUpperCase()}
                          </td>
                          <td className="py-3 px-4 text-sm text-gray-700 dark:text-gray-200">
                            {formatFileSize(format.contentLength)}
                          </td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => handleDownload(format.itag)}
                              className="flex items-center text-sm bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-3 rounded-lg transition-colors"
                            >
                              <FaDownload className="mr-1" />
                              İndir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="py-4 px-8 bg-gray-100 dark:bg-gray-900 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>Bu uygulama eğitim amaçlıdır. Telif hakkı içeren içerikleri indirmeden önce gerekli izinleri aldığınızdan emin olun.</p>
        </div>
      </div>
    </div>
  );
}
