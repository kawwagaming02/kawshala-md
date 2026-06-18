const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

const pendingBaiscope = {};

// 1. BAISCOPE.LK API එක හරහා සෙවීම
async function searchBaiscope(query) {
  try {
    const apiUrl = `https://www.baiscope.lk/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=10`;
    const { data } = await axios.get(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });

    if (!Array.isArray(data) || data.length === 0) return [];

    return data.map((item, index) => ({
      id: index + 1,
      title: item.title?.rendered ? item.title.rendered.replace(/&#8211;/g, "-").replace(/&#8217;/g, "'").replace(/\[සිංහල උපසිරැසි සමඟ\]|\[සිංහල උපසිරසි\]/gi, "").trim() : "Movie",
      movieUrl: item.link
    }));
  } catch (error) {
    console.error("Baiscope API Error:", error.message);
    return [];
  }
}

// 2. තෝරාගත් චිත්‍රපටයේ තොරතුරු/ලින්ක්ස් ලබා ගැනීම (Scraper)
async function getBaiscopeDetails(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    const $ = cheerio.load(data);
    
    // ලිපියේ ඇති පළමු ඉමේජ් එක ලබා ගැනීම (Thumbnail)
    const thumbnail = $(".entry-content img").first().attr("src") || $(".post-thumbnail img").first().attr("src") || "";
    
    // ලිපිය පිළිබඳ කෙටි හැඳින්වීමක්
    let description = $(".entry-content p").slice(0, 3).text().trim();
    if (description.length > 300) description = description.substring(0, 300) + "...";

    // බාගත කිරීමේ ලින්ක්ස් (Download links) සොයා ගැනීම
    let downloadLinks = [];
    $(".entry-content a").each((i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      
      // Torrent හෝ Direct Download ලින්ක්ස් වෙන්කර හඳුනා ගැනීම
      if (href && (href.includes("torrent") || href.includes("magnet") || href.includes("drive.google") || href.includes("mega") || href.includes("pixeldrain"))) {
        downloadLinks.push({
          name: text || `Download Link ${i+1}`,
          link: href
        });
      }
    });

    return { thumbnail, description, downloadLinks };
  } catch (e) {
    return { thumbnail: "", description: "No description available.", downloadLinks: [] };
  }
}

// --- CMD 1: BAISCOPE SEARCH ---
cmd({
  pattern: "baiscope",
  alias: ["bs", "bscope"],
  react: "🎬",
  desc: "Search and get movie info/subtitles from Baiscope.lk",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(`*🎬 Baiscope Movie Search*\n\nUsage: .bs movie_name\nExample: .bs Avatar`);
  reply("*🔍 Searching Baiscope.lk database...*");

  const results = await searchBaiscope(q);
  if (!results || results.length === 0) return reply("*❌ No posts found on Baiscope for your query!*");

  pendingBaiscope[sender] = { results, timestamp: Date.now() };

  let text = "*🎬 Baiscope Sinhala Subtitle Results:*\n\n";
  results.forEach((res, i) => {
    text += `*${i+1}.* ${res.title}\n`;
  });
  text += `\n*Reply with the number (1-${results.length}) to get details.*`;
  
  reply(text);
});

// --- CMD 2: GET DETAILS & DOWNLOAD LINKS ---
cmd({
  filter: (text, { sender }) => pendingBaiscope[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingBaiscope[sender].results.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "📥", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selected = pendingBaiscope[sender].results[index];
  delete pendingBaiscope[sender]; // clear cache

  reply("*⏳ Extracting movie details and subtitle/download links...*");
  const details = await getBaiscopeDetails(selected.movieUrl);

  let msg = `*🎬 ${selected.title}*\n\n`;
  msg += `*📝 Description:* ${details.description || "N/A"}\n\n`;
  msg += `*🌐 Post URL:* ${selected.movieUrl}\n\n`;
  
  if (details.downloadLinks.length > 0) {
    msg += `*🔗 Available Download / Subtitle Links:*\n`;
    details.downloadLinks.slice(0, 10).forEach((dl, i) => {
      msg += `\n*${i+1}. ${dl.name}*\n🔗 ${dl.link}\n`;
    });
  } else {
    msg += `*⚠️ Direct download links not found. Please visit the Post URL to manually download the subtitle file.*`;
  }

  if (details.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: details.thumbnail }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
});

// Cache Cleaner (10 mins timeout)
setInterval(() => {
  const now = Date.now();
  for (const s in pendingBaiscope) {
    if (now - pendingBaiscope[s].timestamp > 10 * 60 * 1000) delete pendingBaiscope[s];
  }
}, 5 * 60 * 1000);
