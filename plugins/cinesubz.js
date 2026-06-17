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

function getDirectPixeldrainUrl(url) {
  const match = url.match(/pixeldrain\.com\/u\/(\w+)/);
  if (!match) return null;
  return `https://pixeldrain.com/api/file/${match[1]}?download`;
}

// Modified for Cinesubz
async function searchMovies(query) {
  const searchUrl = `https://cinesubz.lk/?s=${encodeURIComponent(query)}&post_type=movies`;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });
  
  // Updated selectors for Cinesubz
  const results = await page.$$eval(".post-item, .movie-item, .film-item", boxes =>
    boxes.slice(0, 10).map((box, index) => {
      const a = box.querySelector("a");
      const img = box.querySelector("img");
      const title = box.querySelector(".title, .movie-title, .entry-title")?.textContent || "";
      const quality = box.querySelector(".quality, .movie-quality")?.textContent || "";
      const lang = box.querySelector(".language, .movie-lang")?.textContent || "";
      
      return {
        id: index + 1,
        title: title.trim() || a?.title?.trim() || "",
        movieUrl: a?.href || "",
        thumb: img?.src || "",
        language: lang.trim(),
        quality: quality.trim(),
        qty: "Movie"
      };
    }).filter(m => m.title && m.movieUrl)
  );
  await browser.close();
  return results;
}

// Modified for Cinesubz metadata
async function getMovieMetadata(url) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  
  const metadata = await page.evaluate(() => {
    const getText = el => el?.textContent.trim() || "";
    const getList = selector => Array.from(document.querySelectorAll(selector)).map(el => el.textContent.trim());
    
    // Updated selectors for Cinesubz
    const title = getText(document.querySelector(".entry-title, .movie-title, h1.entry-title"));
    
    let language = "", directors = [], stars = [], imdb = "", duration = "", genres = [];
    
    // Try different selectors for movie info
    const info = document.querySelector(".movie-info, .entry-content, .single-movie-info");
    if (info) {
      const paragraphs = info.querySelectorAll("p, .info-item");
      paragraphs.forEach(p => {
        const text = p.textContent.toLowerCase();
        if (text.includes("language") || text.includes("lang")) {
          language = p.textContent.replace(/language:?/i, "").trim();
        }
        if (text.includes("director")) {
          directors = Array.from(p.querySelectorAll("a")).map(a => a.textContent.trim());
          if (!directors.length) directors = [p.textContent.replace(/director:?/i, "").trim()];
        }
        if (text.includes("cast") || text.includes("star")) {
          stars = Array.from(p.querySelectorAll("a")).map(a => a.textContent.trim());
          if (!stars.length) stars = [p.textContent.replace(/cast:?/i, "").trim()];
        }
        if (text.includes("genre")) {
          genres = Array.from(p.querySelectorAll("a")).map(a => a.textContent.trim());
          if (!genres.length) genres = [p.textContent.replace(/genre:?/i, "").trim()];
        }
        if (text.includes("imdb")) {
          imdb = p.textContent.replace(/imdb:?/i, "").trim();
        }
        if (text.includes("duration")) {
          duration = p.textContent.replace(/duration:?/i, "").trim();
        }
      });
    }
    
    const thumbnail = document.querySelector(".movie-poster img, .post-thumbnail img, .featured-image img")?.src || "";
    
    return { 
      title, 
      language, 
      duration, 
      imdb, 
      genres: genres.length ? genres : ["N/A"],
      directors: directors.length ? directors : ["N/A"],
      stars: stars.length ? stars : ["N/A"],
      thumbnail 
    };
  });
  await browser.close();
  return metadata;
}

// Modified for Cinesubz - use more general link extraction
async function getDownloadLinks(movieUrl) {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(movieUrl, { waitUntil: "networkidle2", timeout: 30000 });
  
  // Try to find download links - more generalized
  const linksData = await page.evaluate(() => {
    const links = [];
    
    // Look for various download link patterns
    const downloadElements = document.querySelectorAll(
      '.download-link, .download-btn, .movie-download a, .link-download a, .pixeldrain-link, a[href*="pixeldrain"]'
    );
    
    downloadElements.forEach(el => {
      const href = el.href || el.dataset?.href;
      if (href) {
        let quality = "";
        const parentText = el.closest('tr, div, li, td')?.textContent || "";
        const qualityMatch = parentText.match(/(1080|720|480|HD|FHD|SD)/i);
        if (qualityMatch) quality = qualityMatch[1];
        
        // Try to get quality from class or data attributes
        if (!quality) {
          const classes = el.className + " " + (el.closest('tr, div, li, td')?.className || "");
          const classMatch = classes.match(/(1080|720|480|HD|FHD|SD)/i);
          if (classMatch) quality = classMatch[1];
        }
        
        links.push({
          pageLink: href,
          quality: quality || "Unknown",
          size: "Unknown"
        });
      }
    });
    
    return links;
  });
  
  // Process links to get direct Pixeldrain URLs
  const directLinks = [];
  for (const l of linksData) {
    try {
      let finalUrl = l.pageLink;
      
      // If it's not a direct pixeldrain link, try to navigate
      if (!l.pageLink.includes('pixeldrain.com')) {
        try {
          const subPage = await browser.newPage();
          await subPage.goto(l.pageLink, { waitUntil: "networkidle2", timeout: 30000 });
          await new Promise(r => setTimeout(r, 5000));
          
          // Try to find pixeldrain link
          const pixeldrainLink = await subPage.$eval('a[href*="pixeldrain.com"]', el => el.href).catch(() => null);
          if (pixeldrainLink) finalUrl = pixeldrainLink;
          await subPage.close();
        } catch (e) {
          continue;
        }
      }
      
      // Check size if available
      const directUrl = getDirectPixeldrainUrl(finalUrl);
      if (directUrl) {
        // Try to get size from headers
        try {
          const sizeResponse = await fetch(directUrl, { method: 'HEAD' });
          const size = parseInt(sizeResponse.headers.get('content-length') || '0');
          const sizeMB = size / (1024 * 1024);
          
          if (sizeMB > 0 && sizeMB <= 2048) {
            directLinks.push({
              link: finalUrl,
              quality: normalizeQuality(l.quality),
              size: `${Math.round(sizeMB)} MB`
            });
          }
        } catch (e) {
          // If can't get size, assume it's small enough
          directLinks.push({
            link: finalUrl,
            quality: normalizeQuality(l.quality),
            size: l.size
          });
        }
      }
    } catch (e) {
      continue;
    }
  }
  
  await browser.close();
  return directLinks;
}

cmd({
  pattern: "cs",
  alias: ["cinesubz", "films", "cinema"],
  react: "🎬",
  desc: "Search and send movies from Cinesubz.lk",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) return reply(`*🎬 Cinesubz Movie Search*\nUsage: .movie movie_name\nExample: .movie john wick`);
  
  reply("*🔍 Searching for movies on Cinesubz...*");
  const searchResults = await searchMovies(q);
  
  if (!searchResults.length) return reply("*❌ No movies found on Cinesubz!*");
  
  pendingSearch[sender] = { results: searchResults, timestamp: Date.now() };
  
  let text = "*🎬 Cinesubz Search Results:*\n\n";
  searchResults.forEach((m, i) => {
    text += `*${i+1}.* ${m.title}\n`;
    if (m.language) text += `   📝 Language: ${m.language}\n`;
    if (m.quality) text += `   📊 Quality: ${m.quality}\n`;
    text += `   🔗 Click: ${m.movieUrl}\n\n`;
  });
  text += `*Reply with movie number (1-${searchResults.length})*`;
  reply(text);
});

cmd({
  filter: (text, { sender }) => pendingSearch[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingSearch[sender].results.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selected = pendingSearch[sender].results[index];
  delete pendingSearch[sender];
  
  reply("*📖 Fetching movie details...*");
  const metadata = await getMovieMetadata(selected.movieUrl);
  
  let msg = `*🎬 ${metadata.title || selected.title}*\n\n`;
  msg += `*📝 Language:* ${metadata.language || "N/A"}\n`;
  msg += `*⏱️ Duration:* ${metadata.duration || "N/A"}\n`;
  msg += `*⭐ IMDb:* ${metadata.imdb || "N/A"}\n`;
  msg += `*🎭 Genres:* ${metadata.genres.join(", ")}\n`;
  msg += `*🎥 Directors:* ${metadata.directors.join(", ")}\n`;
  msg += `*🌟 Stars:* ${metadata.stars.slice(0,5).join(", ")}${metadata.stars.length>5?"...":""}\n\n`;
  msg += "*🔗 Fetching download links, please wait...*";
  
  if (metadata.thumbnail) {
    await danuwa.sendMessage(from, { image: { url: metadata.thumbnail }, caption: msg }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
  
  const downloadLinks = await getDownloadLinks(selected.movieUrl);
  
  if (!downloadLinks.length) {
    return reply("*❌ No download links found! Try searching manually at cinesubz.lk*");
  }
  
  pendingQuality[sender] = { movie: { metadata, downloadLinks }, timestamp: Date.now() };
  
  let qualityMsg = "*📥 Available Qualities:*\n\n";
  downloadLinks.forEach((d,i) => {
    qualityMsg += `*${i+1}.* ${d.quality} - ${d.size || "Unknown size"}\n`;
  });
  qualityMsg += `\n*Reply with quality number to receive the movie.*`;
  
  await danuwa.sendMessage(from, { text: qualityMsg }, { quoted: mek });
});

cmd({
  filter: (text, { sender }) => pendingQuality[sender] && !isNaN(text) && parseInt(text) > 0 && parseInt(text) <= pendingQuality[sender].movie.downloadLinks.length
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const { movie } = pendingQuality[sender];
  delete pendingQuality[sender];
  
  const selectedLink = movie.downloadLinks[index];
  reply(`*⬇️ Sending ${selectedLink.quality} movie...*\nPlease wait.`);
  
  try {
    const directUrl = getDirectPixeldrainUrl(selectedLink.link);
    if (!directUrl) {
      return reply("*❌ Could not generate direct download URL!*");
    }
    
    const fileName = `${movie.metadata.title || "Movie"} - ${selectedLink.quality}.mp4`
      .replace(/[^\w\s.-]/gi, '')
      .substring(0, 50);
    
    await danuwa.sendMessage(from, {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: fileName,
      caption: `*🎬 ${movie.metadata.title || "Movie"}*\n*📊 Quality:* ${selectedLink.quality}\n*💾 Size:* ${selectedLink.size}\n\n*Enjoy your movie! 🍿*`
    }, { quoted: mek });
    
  } catch (error) {
    console.error("Send document error:", error);
    reply(`*❌ Failed to send movie:* ${error.message || "Unknown error"}\n\nTry downloading manually from: ${selectedLink.link}`);
  }
});

// Clean up pending sessions
setInterval(() => {
  const now = Date.now();
  const timeout = 10*60*1000; // 10 minutes
  for (const s in pendingSearch) {
    if (now - pendingSearch[s].timestamp > timeout) delete pendingSearch[s];
  }
  for (const s in pendingQuality) {
    if (now - pendingQuality[s].timestamp > timeout) delete pendingQuality[s];
  }
}, 5*60*1000);

module.exports = { pendingSearch, pendingQuality };
