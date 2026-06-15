const { cmd } = require("../command");
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

function getDirectDownloadUrl(url) {
  // Baiscope direct download URL extraction
  if (url.includes("baiscope.lk")) {
    return url;
  }
  return url;
}

async function searchBaiscopeMovies(query) {
  const searchUrl = `https://baiscope.lk/?s=${encodeURIComponent(query)}&post_type=movies`;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });
  
  const results = await page.$$eval(".movie-item, .post-item, .film-item", boxes =>
    boxes.slice(0, 10).map((box, index) => {
      const a = box.querySelector("a");
      const img = box.querySelector("img");
      const title = box.querySelector(".title, h2, h3")?.textContent || "";
      const year = box.querySelector(".year, .release-year")?.textContent || "";
      const quality = box.querySelector(".quality, .video-quality")?.textContent || "";
      return {
        id: index + 1,
        title: title.trim() || a?.title?.trim() || "",
        movieUrl: a?.href || "",
        thumb: img?.src || "",
        year: year.trim(),
        quality: quality.trim(),
      };
    }).filter(m => m.title && m.movieUrl)
  );
  
  await browser.close();
  return results;
}

async function getBaiscopeMovieMetadata(url) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  
  const metadata = await page.evaluate(() => {
    const getText = el => el?.textContent?.trim() || "";
    
    // Baiscope specific selectors
    const title = getText(document.querySelector("h1.entry-title, .movie-title, .film-title"));
    const year = getText(document.querySelector(".year, .release-date, .movie-year"));
    const duration = getText(document.querySelector(".duration, .runtime, .movie-time"));
    const rating = getText(document.querySelector(".rating, .imdb-rating, .movie-rating"));
    const language = getText(document.querySelector(".language, .movie-lang"));
    
    // Get genres
    const genres = [];
    document.querySelectorAll(".genre a, .movie-genres a").forEach(el => {
      genres.push(el.textContent.trim());
    });
    
    // Get directors
    const directors = [];
    document.querySelectorAll(".director a, .movie-director a").forEach(el => {
      directors.push(el.textContent.trim());
    });
    
    // Get cast
    const cast = [];
    document.querySelectorAll(".cast a, .movie-cast a, .actors a").forEach(el => {
      cast.push(el.textContent.trim());
    });
    
    // Description
    const description = getText(document.querySelector(".description, .movie-desc, .synopsis, .plot"));
    
    // Thumbnail
    const thumbnail = document.querySelector(".poster img, .movie-poster img, .featured-image img")?.src || "";
    
    return { 
      title, year, duration, rating, language, 
      genres, directors, cast, description, thumbnail 
    };
  });
  
  await browser.close();
  return metadata;
}

async function getBaiscopeDownloadLinks(movieUrl) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(movieUrl, { waitUntil: "networkidle2", timeout: 30000 });
  
  const linksData = await page.$$eval(".download-links a, .server-link a, .download-btn", (links) =>
    links.map(link => {
      const quality = link.querySelector(".quality, .server-name")?.textContent?.trim() || 
                      link.textContent.match(/\d{3,4}p/i)?.[0] || "HD";
      const size = link.querySelector(".size, .file-size")?.textContent?.trim() || "";
      const href = link.href || "";
      return { pageLink: href, quality: normalizeQuality(quality), size };
    }).filter(l => l.pageLink && !l.pageLink.includes("#"))
  );
  
  const directLinks = [];
  
  for (const link of linksData) {
    try {
      let finalUrl = link.pageLink;
      
      // If it's a redirect page, follow it
      if (link.pageLink.includes("/go/") || link.pageLink.includes("/redirect/")) {
        const subPage = await browser.newPage();
        await subPage.goto(link.pageLink, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise(r => setTimeout(r, 5000));
        
        finalUrl = await subPage.evaluate(() => {
          const directLink = document.querySelector(".download-link a, .direct-link a, .final-link")?.href;
          const onPageLink = document.querySelector("a[href*='.mp4'], a[href*='.mkv'], a[href*='download']")?.href;
          return directLink || onPageLink || window.location.href;
        }).catch(() => link.pageLink);
        
        await subPage.close();
      }
      
      // Check if it's a valid video link
      if (finalUrl && (finalUrl.includes('.mp4') || finalUrl.includes('.mkv') || finalUrl.includes('download'))) {
        directLinks.push({ 
          link: finalUrl, 
          quality: link.quality, 
          size: link.size || "Unknown" 
        });
      }
      
    } catch (e) {
      console.error("Error processing link:", e);
      continue;
    }
  }
  
  await browser.close();
  return directLinks;
}

// Main search command
cmd({
  pattern: "baiscope",
  alias: ["bs", "sinhalamovie", "baifilm"],
  react: "🎬",
  desc: "Search and download movies from Baiscope.lk",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(`*🎬 Baiscope.lk Movie Search*\n\nUsage: .baiscope movie_name\n\n📝 Example: .baiscope චෙරියෝ\n\n🔍 Search Sinhala movies with subtitles`);
  
  reply("*🔍 Searching Baiscope.lk for movies...*\n⏳ Please wait...");
  
  const searchResults = await searchBaiscopeMovies(q);
  
  if (!searchResults.length) {
    return reply("*❌ No movies found on Baiscope.lk!*\n\n💡 Try different keywords or check spelling.");
  }
  
  pendingSearch[sender] = { results: searchResults, timestamp: Date.now() };
  
  let text = "*🎬 Baiscope.lk Search Results:*\n\n";
  searchResults.forEach((m, i) => {
    text += `*${i+1}.* ${m.title}\n`;
    if (m.year) text += `   📅 Year: ${m.year}\n`;
    if (m.quality) text += `   📊 Quality: ${m.quality}\n`;
    text += `\n`;
  });
  
  text += `*Reply with movie number (1-${searchResults.length})* to see details.`;
  reply(text);
});

// Movie selection handler
cmd({
  filter: (text, { sender }) => pendingSearch[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingSearch[sender].results.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selected = pendingSearch[sender].results[index];
  delete pendingSearch[sender];
  
  reply("*📖 Fetching movie details...*");
  
  const metadata = await getBaiscopeMovieMetadata(selected.movieUrl);
  
  let msg = `*🎬 ${metadata.title || selected.title}*\n\n`;
  if (metadata.year) msg += `*📅 Year:* ${metadata.year}\n`;
  if (metadata.duration) msg += `*⏱️ Duration:* ${metadata.duration}\n`;
  if (metadata.rating) msg += `*⭐ Rating:* ${metadata.rating}\n`;
  if (metadata.language) msg += `*📝 Language:* ${metadata.language}\n`;
  if (metadata.genres && metadata.genres.length) msg += `*🎭 Genres:* ${metadata.genres.join(", ")}\n`;
  if (metadata.directors && metadata.directors.length) msg += `*🎥 Director:* ${metadata.directors.join(", ")}\n`;
  if (metadata.cast && metadata.cast.length) msg += `*🌟 Cast:* ${metadata.cast.slice(0, 5).join(", ")}${metadata.cast.length > 5 ? "..." : ""}\n`;
  if (metadata.description) {
    const desc = metadata.description.length > 200 ? metadata.description.substring(0, 200) + "..." : metadata.description;
    msg += `\n*📖 Synopsis:*\n${desc}\n`;
  }
  
  msg += `\n*🔗 Fetching download links...*`;
  
  if (metadata.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: metadata.thumbnail }, caption: msg }, { quoted: mek });
  } else if (selected.thumb) {
    await danuwa.sendMessage(from, { image: { url: selected.thumb }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
  
  const downloadLinks = await getBaiscopeDownloadLinks(selected.movieUrl);
  
  if (!downloadLinks.length) {
    return reply("*❌ No download links available for this movie!*");
  }
  
  pendingQuality[sender] = { movie: { metadata, downloadLinks, title: selected.title }, timestamp: Date.now() };
  
  let qualityMsg = "*📥 Available Download Options:*\n\n";
  downloadLinks.forEach((d, i) => {
    qualityMsg += `*${i+1}.* ${d.quality || "HD"} - ${d.size}\n`;
  });
  qualityMsg += `\n*Reply with quality number to receive the movie as a document.*`;
  
  await danuwa.sendMessage(from, { text: qualityMsg }, { quoted: mek });
});

// Quality selection and download handler
cmd({
  filter: (text, { sender }) => pendingQuality[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingQuality[sender].movie.downloadLinks.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "📥", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const { movie } = pendingQuality[sender];
  delete pendingQuality[sender];
  
  const selectedLink = movie.downloadLinks[index];
  
  reply(`*⬇️ Sending ${selectedLink.quality} movie...*\n⏳ Please wait while we prepare your download.`);
  
  try {
    const directUrl = getDirectDownloadUrl(selectedLink.link);
    const fileName = `${(movie.metadata.title || movie.title).substring(0, 50)} - ${selectedLink.quality}.mp4`.replace(/[^\w\s.-]/gi, '');
    
    await danuwa.sendMessage(from, {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: fileName,
      caption: `*🎬 ${movie.metadata.title || movie.title}*\n\n` +
               `*📊 Quality:* ${selectedLink.quality}\n` +
               `*💾 Size:* ${selectedLink.size}\n\n` +
               `*🎬 Baiscope.lk - Sinhala Subtitles*\n` +
               `*🍿 Enjoy your movie!*`
    }, { quoted: mek });
    
  } catch (error) {
    console.error("Send document error:", error);
    reply(`*❌ Failed to send movie:* ${error.message || "Unknown error"}\n\nPlease try again later.`);
  }
});

// Clean up old pending requests (every 10 minutes)
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000; // 10 minutes
  
  for (const s in pendingSearch) {
    if (now - pendingSearch[s].timestamp > timeout) delete pendingSearch[s];
  }
  for (const s in pendingQuality) {
    if (now - pendingQuality[s].timestamp > timeout) delete pendingQuality[s];
  }
}, 5 * 60 * 1000);

module.exports = { pendingSearch, pendingQuality };
