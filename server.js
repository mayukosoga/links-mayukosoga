import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app  = express();
const PORT = process.env.PORT || 3000;
const __dir = dirname(fileURLToPath(import.meta.url));

// 静的ファイルを配信
app.use(express.static(__dir));

const YT_HEADERS = { Referer: 'https://designup-academy.com/' };

// ISO 8601 duration (PT1M30S) → 秒数
function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

async function ytFetch(url) {
  const res = await fetch(url, { headers: YT_HEADERS });
  if (!res.ok) {
    const err = await res.json();
    throw Object.assign(new Error(err.error?.message || 'YouTube API エラー'), { status: res.status });
  }
  return res.json();
}

// YouTube 動画一覧プロキシ（ショート除外）
// GET /api/youtube?channelId=UCxxxxxx&maxResults=5
app.get('/api/youtube', async (req, res) => {
  const apiKey     = process.env.YOUTUBE_API_KEY;
  const channelId  = req.query.channelId;
  const maxResults = Number(req.query.maxResults) || 5;

  if (!apiKey)    return res.status(500).json({ error: 'YOUTUBE_API_KEY が設定されていません' });
  if (!channelId) return res.status(400).json({ error: 'channelId が必要です' });

  try {
    // ショート除外のため多めに取得（ショートが混じっていても maxResults 件確保する）
    const fetchCount = maxResults * 3;

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part',       'snippet');
    searchUrl.searchParams.set('channelId',  channelId);
    searchUrl.searchParams.set('maxResults', fetchCount);
    searchUrl.searchParams.set('order',      'date');
    searchUrl.searchParams.set('type',       'video');
    searchUrl.searchParams.set('key',        apiKey);

    const searchData = await ytFetch(searchUrl.toString());
    if (!searchData.items?.length) return res.json({ items: [] });

    // 動画IDをまとめて contentDetails を取得（尺の確認）
    const videoIds = searchData.items.map(v => v.id.videoId).join(',');

    const detailUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    detailUrl.searchParams.set('part', 'contentDetails');
    detailUrl.searchParams.set('id',   videoIds);
    detailUrl.searchParams.set('key',  apiKey);

    const detailData = await ytFetch(detailUrl.toString());

    // videoId → 秒数 のマップを作成
    const durationMap = Object.fromEntries(
      detailData.items.map(v => [v.id, parseDuration(v.contentDetails.duration)])
    );

    // 60秒以下（ショート）を除外して maxResults 件に絞る
    const filtered = searchData.items
      .filter(v => (durationMap[v.id.videoId] ?? 0) > 60)
      .slice(0, maxResults);

    res.json({ items: filtered });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'サーバーエラー' });
  }
});

app.listen(PORT, () => {
  console.log(`✓ http://localhost:${PORT} で起動中`);
});
