const { cmd } = require("../command");
const axios = require("axios");

const pendingYTS = {};

// --- CMD 1: SEARCH MOVIES ---
cmd({
  pattern: "yts",
  alias: ["movie2", "englishmovie", "yify"],
  react: "🎬",
  desc: "Search English movies from YTS official API",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply("*🎬 Usage:* .yts <movie_name>\n*Example:* .yts Interstellar");
  reply("*🔍 Querying official YTS database...*");

  try {
    const apiUrl = `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(q)}&limit=10`;
    const { data } = await axios.get(apiUrl, { timeout: 15000 });

    if (!data || data.status !== "ok" || !data.data.movies || data.data.movies.length === 0) {
      return reply("*❌ No English movies found matching your query!*");
    }

    const movies = data.data.movies;
    pendingYTS[sender] = { movies, timestamp: Date.now() };

    let text = "*🎬 YTS English Movie Results:*\n\n";
    movies.forEach((mv, i) => {
      text += `*${i+1}.* ${mv.title_long} (${mv.language.toUpperCase()}) - ⭐ ${mv.rating}\n`;
    });
    text += `\n*Reply with the number (1-${movies.length}) to get download links and info.*`;
    
    reply(text);
  } catch (e) {
    console.error(e);
    reply("*❌ Error communicating with YTS API! Please try again later.*");
  }
});

// --- CMD 2: SELECT & EXTRACT DETAILED LINKS ---
cmd({
  filter: (text, { sender }) => pendingYTS[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingYTS[sender].movies.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "📥", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selectedMovie = pendingYTS[sender].movies[index];
  delete pendingYTS[sender];

  let msg = `*🎬 ${selectedMovie.title_long}*\n\n`;
  msg += `*⭐ Rating:* ${selectedMovie.rating} / 10\n`;
  msg += `*⏳ Runtime:* ${selectedMovie.runtime} min\n`;
  msg += `*🎭 Genres:* ${selectedMovie.genres ? selectedMovie.genres.join(", ") : "N/A"}\n\n`;
  msg += `*📝 Synopsis:* ${selectedMovie.synopsis ? selectedMovie.synopsis.substring(0, 300) : "No description available."}...\n\n`;
  
  if (selectedMovie.torrents && selectedMovie.torrents.length > 0) {
    msg += `*📥 Available Direct Torrent File Links:*\n`;
    selectedMovie.torrents.forEach((tor, i) => {
      msg += `\n*${i+1}. Quality: ${tor.quality} (${tor.type.toUpperCase()})*\n`;
      msg += `📦 Size: ${tor.size}\n`;
      msg += `🔗 Link: ${tor.url}\n`;
    });
  } else {
    msg += `*⚠️ Direct download files not indexed for this entry.*`;
  }

  // Send along with the high-resolution movie cover art if available
  if (selectedMovie.large_cover_image || selectedMovie.medium_cover_image) {
    await danuwa.sendMessage(from, { 
      image: { url: selectedMovie.large_cover_image || selectedMovie.medium_cover_image }, 
      caption: msg 
    }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
});

// Cache cleaner to release server memory
setInterval(() => {
  const now = Date.now();
  for (const s in pendingYTS) {
    if (now - pendingYTS[s].timestamp > 10 * 60 * 1000) delete pendingYTS[s];
  }
}, 5 * 60 * 1000);
