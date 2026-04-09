// Cloudflare Pages Function: /api/youtube
// ISO 8601 duration (PT1M30S) → 秒数
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const apiKey     = env.YOUTUBE_API_KEY;
  const channelId  = url.searchParams.get('channelId');
  const maxResults = Number(url.searchParams.get('maxResults')) || 5;

  if (!apiKey)    return Response.json({ error: 'YOUTUBE_API_KEY が設定されていません' }, { status: 500 });
  if (!channelId) return Response.json({ error: 'channelId が必要です' }, { status: 400 });

  // 24時間キャッシュ
  const cacheKey = new Request(`https://cache.internal/youtube?channelId=${channelId}&maxResults=${maxResults}`);
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const YT_HEADERS = { Referer: 'https://designup-academy.com/' };

  try {
    const fetchCount = maxResults * 3;

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part',       'snippet');
    searchUrl.searchParams.set('channelId',  channelId);
    searchUrl.searchParams.set('maxResults', fetchCount);
    searchUrl.searchParams.set('order',      'date');
    searchUrl.searchParams.set('type',       'video');
    searchUrl.searchParams.set('key',        apiKey);

    const searchRes = await fetch(searchUrl.toString(), { headers: YT_HEADERS });
    if (!searchRes.ok) {
      const err = await searchRes.json();
      return Response.json({ error: err.error?.message || 'YouTube API エラー' }, { status: searchRes.status });
    }
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return Response.json({ items: [] });

    const videoIds = searchData.items.map(v => v.id.videoId).join(',');

    const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailUrl.searchParams.set('part', 'contentDetails');
    detailUrl.searchParams.set('id',   videoIds);
    detailUrl.searchParams.set('key',  apiKey);

    const detailRes = await fetch(detailUrl.toString(), { headers: YT_HEADERS });
    if (!detailRes.ok) {
      const err = await detailRes.json();
      return Response.json({ error: err.error?.message || 'YouTube API エラー' }, { status: detailRes.status });
    }
    const detailData = await detailRes.json();

    const durationMap = Object.fromEntries(
      detailData.items.map(v => [v.id, parseDuration(v.contentDetails.duration)])
    );

    const filtered = searchData.items
      .filter(v => (durationMap[v.id.videoId] ?? 0) > 60)
      .slice(0, maxResults);

    const response = new Response(JSON.stringify({ items: filtered }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=86400', // 24時間
      }
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return Response.json({ error: err.message || 'サーバーエラー' }, { status: 500 });
  }
}
