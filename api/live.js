let cache = null;
let cacheTime = 0;
const CACHE_DURATION = 900000; // 15 minutes

export default async function handler(req, res) {
  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = 'UC-tkswecO7QoVZBxdkS3qIQ';

  // Cache mémoire — évite d'appeler YouTube à chaque requête
  const now = Date.now();
  if (cache && (now - cacheTime) < CACHE_DURATION) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    return res.status(200).json(cache);
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    const live    = !!(data.items && data.items.length > 0);
    const videoId = live ? data.items[0].id.videoId : null;

    cache = { live, videoId };
    cacheTime = now;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    res.status(200).json(cache);

  } catch (err) {
    res.status(500).json({ live: false, videoId: null, error: err.message });
  }
}
