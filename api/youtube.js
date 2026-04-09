// Vercel Serverless Function: /api/youtube
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

export default async function handler(req, res) {
  const apiKey     = process.env.YOUTUBE_API_KEY;
  const channelId  = req.query.channelId;
  const maxResults = Number(req.query.maxResults) || 5;

  if (!apiKey)    return res.status(500).json({ error: 'YOUTUBE_API_KEY が設定されていません' });
  if (!channelId) return res.status(400).json({ error: 'channelId が必要です' });

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
      return res.status(searchRes.status).json({ error: err.error?.message || 'YouTube API エラー' });
    }
    const searchData = await searchRes.json();
    if (!searchData.items?.length) return res.json({ items: [] });

    const videoIds = searchData.items.map(v => v.id.videoId).join(',');

    const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailUrl.searchParams.set('part', 'contentDetails');
    detailUrl.searchParams.set('id',   videoIds);
    detailUrl.searchParams.set('key',  apiKey);

    const detailRes = await fetch(detailUrl.toString(), { headers: YT_HEADERS });
    if (!detailRes.ok) {
      const err = await detailRes.json();
      return res.status(detailRes.status).json({ error: err.error?.message || 'YouTube API エラー' });
    }
    const detailData = await detailRes.json();

    const durationMap = Object.fromEntries(
      detailData.items.map(v => [v.id, parseDuration(v.contentDetails.duration)])
    );

    const filtered = searchData.items
      .filter(v => (durationMap[v.id.videoId] ?? 0) > 60)
      .slice(0, maxResults);

    res.json({ items: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message || 'サーバーエラー' });
  }
}
