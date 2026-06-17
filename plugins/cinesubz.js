const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer"); // ලින්ක් ඇතුලට යාමට පමණක් පාවිච්චි වේ

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

// 1. AXIOS හරහා සෙවුම් ක්‍රියාවලිය (වේගවත් සහ සරලයි)
async function searchMovies(query) {
  try {
    const searchUrl = `https://cinesubz.lk/?s=${encodeURIComponent(query)}`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    let results = [];

    // CineSubz search item class එකට අනුව සකසා ඇත
    $(".result-item").each((index, element) => {
      const a = $(element).find(".title a");
      const img = $(element).find(".thumbnail img");
      const meta = $(element).find(".meta").text() || "";
      const rating = $(element).find(".rating").text() || "";
      
      const title = a.text().trim();
      const movieUrl = a.attr("href");

      if (title && movieUrl) {
        results.push({
          id: index + 1,
          title: title,
          movieUrl: movieUrl,
          thumb: img.attr("src") || "",
          language: meta.trim(),
          quality: rating.trim(),
          qty: "Movie"
        });
      }
    });

    return results.slice(0, 10);
  } catch (error) {
    console.error("Search Error:", error);
    return [];
  }
}

// 2. METADATA SCRAPER
async function getMovieMetadata(url) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  
  const metadata = await page.evaluate(() => {
    const getText = el => el?.textContent.trim() || "";
    const title = getText(document.querySelector(".sheader .data h1"));
    const imdb = getText(document.querySelector(".dynamic-color.imdb strong")) || "N/A";
    
    let language = "Sinhala Subtitles", duration = "N/A", directors = [], stars = [];
    
    document.querySelectorAll(".custom_fields").forEach(cf => {
      const label = cf.querySelector(".clabel")?.textContent.trim();
      const val = cf.querySelector(".cvalue")?.textContent.trim();
      if (label === "Language") language = val;
      if (label === "Runtime") duration = val;
    });

    document.querySelectorAll(".scontent .wp-content p").forEach(p => {
      if (p.textContent.includes("Director")) directors.push(p.textContent.replace("Director:", "").trim());
      if (p.textContent.includes("Cast")) stars.push(p.textContent.replace("Cast:", "").trim());
    });

    const genres = Array.from(document.querySelectorAll(".sgenres a")).map(a => a.textContent.trim());
    const thumbnail = document.querySelector(".poster img")?.src || "";
    
    return { title, language, duration, imdb, genres, directors, stars, thumbnail };
  });
  await browser.close();
  return metadata;
}

// 3. PIXELDRAIN LINK EXTRACTOR
async function getPixeldrainLinks(movieUrl) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
  await page.goto(movieUrl, { waitUntil: "networkidle2", timeout: 30000 });
  
  const linksData = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href*='pixeldrain']"))
      .concat(Array.from(document.querySelectorAll(".download-links a")))
      .map(a => {
        const row = a.closest("tr") || a.closest("div");
        const qualityText = row?.textContent || "";
        let matchedQual = "Unknown";
        if (/1080p/i.test(qualityText)) matchedQual = "1080p";
        else if (/720p/i.test(qualityText)) matchedQual = "720p";
        else if (/480p/i.test(qualityText)) matchedQual = "480p";

        return { pageLink: a.href, quality: matchedQual, size: "File" };
      }).filter(l => l.pageLink);
  });

  const directLinks = [];
  const uniqueLinks = Array.from(new Set(linksData.map(a => a.pageLink)))
    .map(pageLink => linksData.find(a => a.pageLink === pageLink));

  for (const l of uniqueLinks) {
    try {
      if (l.pageLink.includes("pixeldrain.com/u/")) {
        directLinks.push({ link: l.pageLink, quality: normalizeQuality(l.quality), size: "Direct Link" });
        continue;
      }
      
      const subPage = await browser.newPage();
      await subPage.goto(l.pageLink, { waitUntil: "networkidle2", timeout: 30000 });
      await new Promise(r => setTimeout(r, 10000));
      
      const finalUrl = await subPage.$eval("a[href*='pixeldrain.com/u/']", el => el.href).catch(() => null);
      if (finalUrl) {
        directLinks.push({ link: finalUrl, quality: normalizeQuality(l.quality), size: "Direct Link" });
      }
      await subPage.close();
    } catch (e) { continue; }
  }
  
  await browser.close();
  return directLinks;
}

// --- CMD 1: MOVIE SEARCH ---
cmd({
  pattern: "cinesub",
  alias: ["cinesubz", "cs", "cin"],
  react: "🎬",
  desc: "Search and send movies from CineSubz.lk",
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
    text += `*${i+1}.* ${m.title}\n   📊 Quality: ${m.quality || "HD"}\n`;
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
  let msg = `*🎬 ${metadata.title}*\n\n`;
  msg += `*📝 Info:* ${metadata.language}\n*⏱️ Duration:* ${metadata.duration}\n*⭐ IMDb:* ${metadata.imdb}\n`;
  msg += `*🎭 Genres:* ${metadata.genres.join(", ")}\n`;
  if (metadata.directors.length) msg += `*🎥 Directors:* ${metadata.directors.join(", ")}\n`;
  
  msg += "\n*🔗 Fetching high-speed Pixeldrain links, please wait...*";
  
  if (metadata.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: metadata.thumbnail }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
  
  const downloadLinks = await getPixeldrainLinks(selected.movieUrl);
  if (!downloadLinks.length) return reply("*❌ No direct download links found!*");
  
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
