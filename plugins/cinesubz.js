const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");

const pendingBaiscope = {};

// 1. RSS FEED හරහා සෙවීම (100% ක්ම බ්ලොක් නොවී ක්‍රියා කරයි)
async function searchBaiscope(query) {
  try {
    // Baiscope RSS feed එක භාවිතයෙන් දත්ත ලබා ගැනීම
    const feedUrl = `https://www.baiscope.lk/feed/?s=${encodeURIComponent(query)}`;
    const { data } = await axios.get(feedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/xml, text/xml, */*"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data, { xmlMode: true });
    let results = [];

    $("item").each((index, element) => {
      const title = $(element).find("title").text().trim();
      const link = $(element).find("link").text().trim();

      if (title && link) {
        results.push({
          id: index + 1,
          title: title.replace(/&#8211;/g, "-").replace(/&#8217;/g, "'").replace(/\[සිංහල උපසිරැසි සමඟ\]|\[සිංහල උපසිරසි\]/gi, "").trim(),
          movieUrl: link
        });
      }
    });

    return results.slice(0, 10);
  } catch (error) {
    console.error("Baiscope RSS Error:", error.message);
    return [];
  }
}

// 2. ලිපියේ විස්තර සහ සබ්ටයිටල් ලින්ක්ස් ලබා ගැනීම
async function getBaiscopeDetails(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });
    const $ = cheerio.load(data);
    
    // ලිපියේ පෝස්ටර් එක හඳුනා ගැනීම
    const thumbnail = $(".entry-content img").first().attr("src") || $(".post-thumbnail img").first().attr("src") || "";
    
    // කෙටි හැඳින්වීමක් සකසා ගැනීම
    let description = "";
    $(".entry-content p").slice(0, 3).each((i, el) => {
      description += $(el).text().trim() + "\n";
    });
    if (description.length > 300) description = description.substring(0, 300) + "...";

    // ඩවුන්ලෝඩ් සහ සබ්ටයිටල් ලින්ක්ස් එකතු කිරීම
    let downloadLinks = [];
    $(".entry-content a").each((i, el) => {
      const href = $(el).attr("href");
      const text = $(el).text().trim();
      
      if (href && (href.includes("baiscopedownloads") || href.includes("torrent") || href.includes("magnet") || href.includes("drive.google") || href.includes("pixeldrain") || href.includes("mega"))) {
        downloadLinks.push({
          name: text || `Download Option ${i+1}`,
          link: href
        });
      }
    });

    return { thumbnail, description, downloadLinks };
  } catch (e) {
    return { thumbnail: "", description: "තොරතුරු ලබා ගැනීමට නොහැකි විය.", downloadLinks: [] };
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
  if (!q) return reply(`*🎬 Baiscope Movie Search*\n\nUsage: .bs movie_name\nExample: .bs Harry Potter`);
  reply("*🔍 Searching Baiscope.lk Feed...*");

  const results = await searchBaiscope(q);
  if (!results || results.length === 0) return reply("*❌ No movies or subtitles found on Baiscope.lk!*");

  pendingBaiscope[sender] = { results, timestamp: Date.now() };

  let text = "*🎬 Baiscope Sinhala Subtitle Results:*\n\n";
  results.forEach((res, i) => {
    text += `*${i+1}.* ${res.title}\n`;
  });
  text += `\n*Reply with the number (1-${results.length}) to get details and download links.*`;
  
  reply(text);
});

// --- CMD 2: GET DETAILS & DOWNLOAD LINKS ---
cmd({
  filter: (text, { sender }) => pendingBaiscope[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingBaiscope[sender].results.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "📥", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selected = pendingBaiscope[sender].results[index];
  delete pendingBaiscope[sender];

  reply("*⏳ Fetching subtitle details and links...*");
  const details = await getBaiscopeDetails(selected.movieUrl);

  let msg = `*🎬 ${selected.title}*\n\n`;
  if (details.description) msg += `*📝 Description:*\n${details.description}\n\n`;
  msg += `*🌐 Post Link:* ${selected.movieUrl}\n\n`;
  
  if (details.downloadLinks.length > 0) {
    msg += `*🔗 Subtitle / Download Links:*\n`;
    details.downloadLinks.slice(0, 8).forEach((dl, i) => {
      msg += `\n*${i+1}. ${dl.name}*\n🔗 ${dl.link}\n`;
    });
  } else {
    msg += `*⚠️ Direct links inside post not found. Please click the "Post Link" above to manually download the subtitle file.*`;
  }

  if (details.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: details.thumbnail }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
});

// Cache Cleaner
setInterval(() => {
  const now = Date.now();
  for (const s in pendingBaiscope) {
    if (now - pendingBaiscope[s].timestamp > 10 * 60 * 1000) delete pendingBaiscope[s];
  }
}, 5 * 60 * 1000);
