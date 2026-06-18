const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

const pendingSearch = {};
const pendingQuality = {};

function normalizeQuality(text) {
  if (!text) return null;
  text = text.toUpperCase();
  if (/1080|FHD/.test(text)) return "1080p";
  if (/720|HD/.test(text)) return "720p";
  if (/480|SD/.test(text)) return "480p";
  return text;
}

function getDirectPixeldrainUrl(url) {
  const match = url.match(/pixeldrain\.com\/u\/(\w+)/);
  if (!match) return null;
  return `https://pixeldrain.com/api/file/${match[1]}?download`;
}

// 1. CINESUBZ නිල API එක මඟින් සෙවීම (කිසිවිටක බ්ලොක් නොවේ)
async function searchMovies(query) {
  try {
    // සයිට් එකේ ඇතුලාන්ත API එකට කෙලින්ම රික්වෙස්ට් එක යැවීම
    const apiUrl = `https://cinesubz.co/wp-json/wp/v2/posts?search=${encodeURIComponent(query)}&per_page=10`;
    const { data } = await axios.get(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      timeout: 15000
    });

    if (!Array.isArray(data) || data.length === 0) return [];

    return data.map((item, index) => ({
      id: index + 1,
      title: item.title?.rendered ? item.title.rendered.replace(/&#8211;/g, "-").replace(/&#8217;/g, "'") : "Movie",
      movieUrl: item.link,
      thumb: "", 
      language: "Sinhala Subtitles",
      quality: "HD",
      qty: "Movie"
    }));
  } catch (error) {
    console.error("CineSubz API Search Error:", error.message);
    return [];
  }
}

// 2. METADATA SCRAPER
async function getMovieMetadata(url) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    
    const metadata = await page.evaluate(() => {
      const getText = el => el?.textContent.trim() || "";
      const title = getText(document.querySelector("h1")) || getText(document.querySelector(".sheader .data h1"));
      
      let language = "Sinhala Subtitles", duration = "N/A", imdb = "N/A";
      let directors = [], stars = [], genres = [];
      
      document.querySelectorAll(".custom_fields, .meta-site, p").forEach(el => {
        const text = el.textContent || "";
        if (text.includes("Language:")) language = text.replace("Language:", "").trim();
        if (text.includes("Runtime:") || text.includes("Duration:")) duration = text.replace(/Runtime:|Duration:/, "").trim();
        if (text.includes("IMDb:")) imdb = text.replace("IMDb:", "").trim();
      });

      const imgEl = document.querySelector(".poster img, .thumbnail img, article img");
      const thumbnail = imgEl ? imgEl.src : "";
      
      return { title, language, duration, imdb, genres, directors, stars, thumbnail };
    });
    return metadata;
  } catch (e) {
    return { title: "CineSubz Movie", language: "Sinhala Sub", duration: "N/A", imdb: "N/A", genres: [], directors: [], stars: [], thumbnail: "" };
  } finally {
    await browser.close();
  }
}

// 3. PIXELDRAIN LINK EXTRACTOR
async function getPixeldrainLinks(movieUrl) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.goto(movieUrl, { waitUntil: "networkidle2", timeout: 30000 });
    
    const linksData = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href*='pixeldrain']"))
        .concat(Array.from(document.querySelectorAll(".download-links a, .box a")))
        .map(a => {
          const text = a.textContent || "";
          let matchedQual = "HD";
          if (/1080p/i.test(text)) matchedQual = "1080p";
          else if (/720p/i.test(text)) matchedQual = "720p";
          else if (/480p/i.test(text)) matchedQual = "480p";

          return { pageLink: a.href, quality: matchedQual, size: "File" };
        }).filter(l => l.pageLink && (l.pageLink.includes("pixeldrain") || l.pageLink.includes("link")));
    });

    const directLinks = [];
    const seen = new Set();

    for (const l of linksData) {
      if (seen.has(l.pageLink)) continue;
      seen.add(l.pageLink);

      try {
        if (l.pageLink.includes("pixeldrain.com/u/")) {
          directLinks.push({ link: l.pageLink, quality: normalizeQuality(l.quality), size: "Direct" });
          continue;
        }
        
        const subPage = await browser.newPage();
        await subPage.goto(l.pageLink, { waitUntil: "networkidle2", timeout: 20000 });
        await new Promise(r => setTimeout(r, 8000));
        
        const finalUrl = await subPage.$eval("a[href*='pixeldrain.com/u/']", el => el.href).catch(() => null);
        if (finalUrl) {
          directLinks.push({ link: finalUrl, quality: normalizeQuality(l.quality), size: "Direct" });
        }
        await subPage.close();
      } catch (e) { continue; }
    }
    return directLinks;
  } catch (error) {
    return [];
  } finally {
    await browser.close();
  }
}

// --- CMD 1: MOVIE SEARCH ---
cmd({
  pattern: "cine",
  alias: ["cinesubz", "cs", "cin"],
  react: "🎬",
  desc: "Search and send movies from CineSubz.co",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(`*🎬 CineSubz Search Plugin*\nUsage: .cin movie_name\nExample: .cin harry potter`);
  reply("*🔍 Searching CineSubz database...*");
  
  const searchResults = await searchMovies(q);
  if (!searchResults || searchResults.length === 0) return reply("*❌ No movies found on CineSubz!*");
  
  pendingSearch[sender] = { results: searchResults, timestamp: Date.now() };
  let text = "*🎬 CineSubz Search Results:*\n\n";
  searchResults.forEach((m, i) => {
    text += `*${i+1}.* ${m.title}\n`;
  });
  text += `\n*Reply with movie number (1-${searchResults.length})*`;
  reply(text);
});

// --- CMD 2: SELECT MOVIE & FETCH QUALITIES ---
cmd({
  filter: (text, { sender }) => pendingSearch[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingSearch[sender].results.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  const index = parseInt(body.trim()) - 1;
  const selected = pendingSearch[sender].results[index];
  delete pendingSearch[sender];
  
  const metadata = await getMovieMetadata(selected.movieUrl);
  let msg = `*🎬 ${metadata.title || selected.title}*\n\n`;
  msg += `*📝 Info:* ${metadata.language}\n*⏱️ Duration:* ${metadata.duration}\n*⭐ IMDb:* ${metadata.imdb}\n`;
  
  msg += "\n*🔗 Fetching high-speed Pixeldrain links, please wait...*";
  
  if (metadata.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: metadata.thumbnail }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
  
  const downloadLinks = await getPixeldrainLinks(selected.movieUrl);
  if (!downloadLinks || downloadLinks.length === 0) return reply("*❌ No direct download links found!*");
  
  pendingQuality[sender] = { movie: { metadata, downloadLinks }, timestamp: Date.now() };
  let qualityMsg = "*📥 Available Options (Max 2GB):*\n\n";
  downloadLinks.forEach((d, i) => qualityMsg += `*${i+1}.* Link Option [${d.quality}]\n`);
  qualityMsg += `\n*Reply with the number to receive the movie file directly.*`;
  await danuwa.sendMessage(from, { text: qualityMsg }, { quoted: mek });
});

// --- CMD 3: DOWNLOAD & SEND FILE ---
cmd({
  filter: (text, { sender }) => pendingQuality[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingQuality[sender].movie.downloadLinks.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "📥", key: m.key } });
  const index = parseInt(body.trim()) - 1;
  const { movie } = pendingQuality[sender];
  delete pendingQuality[sender];
  
  const selectedLink = movie.downloadLinks[index];
  reply(`*⬇️ Sending movie as document...*\nThis might take a moment based on file size.`);
  
  try {
    const directUrl = getDirectPixeldrainUrl(selectedLink.link);
    await danuwa.sendMessage(from, {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: `${movie.metadata.title.substring(0,45)} - ${selectedLink.quality}.mp4`.replace(/[^\w\s.-]/gi,''),
      caption: `*🎬 ${movie.metadata.title}*\n*📊 Quality:* ${selectedLink.quality}\n\n*Enjoy your movie! 🍿*`
    }, { quoted: mek });
  } catch (error) {
    console.error("Download Error:", error);
    reply(`*❌ Failed to build or send file automatically:* ${error.message || "Timeout error"}`);
  }
});

// Cleanup routines
setInterval(() => {
  const now = Date.now();
  const timeout = 10*60*1000;
  for (const s in pendingSearch) if (now - pendingSearch[s].timestamp > timeout) delete pendingSearch[s];
  for (const s in pendingQuality) if (now - pendingQuality[s].timestamp > timeout) delete pendingQuality[s];
}, 5*60*1000);

module.exports = { pendingSearch, pendingQuality };
