export default async function handler(req, res) {
  const apiKey    = process.env.YOUTUBE_API_KEY;
  const channelId = 'UC-tkswecO7QoVZBxdkS3qIQ';

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();

    const live    = !!(data.items && data.items.length > 0);
    const videoId = live ? data.items[0].id.videoId : null;

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ live, videoId });

  } catch (err) {
    res.status(500).json({ live: false, videoId: null, error: err.message });
  }
}
