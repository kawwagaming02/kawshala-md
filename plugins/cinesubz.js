const { cmd } = require("../command");
const axios = require("axios");
const cheerio = require("cheerio");
const puppeteer = require("puppeteer");

const pendingSearch = {};
const pendingQuality = {};

// චිත්‍රපට ගුණත්වය සාමාන්‍යකරණය
function normalizeQuality(text) {
  if (!text) return "HD";
  text = text.toUpperCase();
  if (/1080|FHD/.test(text)) return "1080p";
  if (/720|HD/.test(text)) return "720p";
  if (/480|SD/.test(text)) return "480p";
  return "HD";
}

// Pixeldrain සබැඳිය Direct URL එකට හරවන්න
function getDirectPixeldrainUrl(url) {
  if (!url) return null;
  const match = url.match(/pixeldrain\.com\/u\/(\w+)/);
  if (!match) return null;
  return `https://pixeldrain.com/api/file/${match[1]}?download`;
}

// ========== CINESUBZ SEARCH ==========
async function searchMovies(query) {
  try {
    console.log(`🔍 Searching for: ${query}`);
    const searchUrl = `https://cinesubz.lk/?s=${encodeURIComponent(query)}&post_type=movies`;
    
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    const results = [];
    
    // විවිධ selectors වලින් සොයන්න
    const selectors = [
      '.post-item', '.movie-item', '.film-item', 
      'article', '.post', '.entry', '.item',
      '.movies-list .item', '.movie-box', '.result-item',
      '.search-result', '.movie-post'
    ];
    
    let found = false;
    
    for (const selector of selectors) {
      const elements = $(selector);
      if (elements.length > 0) {
        elements.each((i, el) => {
          if (i >= 10) return false;
          
          const a = $(el).find('a').first();
          const title = a.text().trim() || a.attr('title') || $(el).find('.title').text().trim() || '';
          const href = a.attr('href') || '';
          const img = $(el).find('img').first().attr('src') || '';
          
          if (title && href && href.includes('cinesubz.lk')) {
            results.push({
              id: results.length + 1,
              title: title.substring(0, 100),
              movieUrl: href,
              thumb: img || '',
              language: 'සිංහල/ඉංග්‍රීසි',
              quality: 'HD'
            });
          }
        });
        if (results.length > 0) {
          found = true;
          break;
        }
      }
    }
    
    // කිසිවක් හමු නොවුනොත්, සියලුම සබැඳි පරීක්ෂා කරන්න
    if (!found || results.length === 0) {
      $('a[href*="cinesubz.lk"]').each((i, el) => {
        if (i >= 10) return false;
        const href = $(el).attr('href');
        const title = $(el).text().trim() || $(el).attr('title') || '';
        if (href && title && title.length > 3 && !href.includes('category') && !href.includes('tag')) {
          results.push({
            id: results.length + 1,
            title: title.substring(0, 100),
            movieUrl: href,
            thumb: '',
            language: 'සිංහල/ඉංග්‍රීසි',
            quality: 'HD'
          });
        }
      });
    }
    
    console.log(`✅ Found ${results.length} results`);
    return results;
  } catch (error) {
    console.error('Search error:', error.message);
    return [];
  }
}

// ========== MOVIE METADATA ==========
async function getMovieMetadata(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    
    const title = $('.entry-title, .movie-title, h1').first().text().trim() || 'නොදනී';
    const thumbnail = $('.movie-poster img, .post-thumbnail img, .featured-image img').first().attr('src') || '';
    
    // තොරතුරු ලබා ගන්න
    let language = 'නොදනී';
    let duration = 'නොදනී';
    let imdb = 'නොදනී';
    let genres = [];
    let directors = [];
    let stars = [];
    
    $('.movie-info p, .entry-content p, .info-item, .movie-detail').each((i, el) => {
      const text = $(el).text().toLowerCase();
      const content = $(el).text().trim();
      
      if (text.includes('language') || text.includes('භාෂාව')) {
        language = content.replace(/language:?|භාෂාව:?/i, '').trim() || 'නොදනී';
      }
      if (text.includes('duration') || text.includes('කාලය')) {
        duration = content.replace(/duration:?|කාලය:?/i, '').trim() || 'නොදනී';
      }
      if (text.includes('imdb')) {
        imdb = content.replace(/imdb:?/i, '').trim() || 'නොදනී';
      }
      if (text.includes('genre') || text.includes('ප්‍රභේදය')) {
        $(el).find('a').each((j, a) => {
          genres.push($(a).text().trim());
        });
        if (genres.length === 0) genres = [content.replace(/genre:?|ප්‍රභේදය:?/i, '').trim()];
      }
      if (text.includes('director') || text.includes('අධ්‍යක්ෂ')) {
        $(el).find('a').each((j, a) => {
          directors.push($(a).text().trim());
        });
        if (directors.length === 0) directors = [content.replace(/director:?|අධ්‍යක්ෂ:?/i, '').trim()];
      }
      if (text.includes('cast') || text.includes('star') || text.includes('රංගන')) {
        $(el).find('a').each((j, a) => {
          stars.push($(a).text().trim());
        });
        if (stars.length === 0) stars = [content.replace(/cast:?|රංගන:?/i, '').trim()];
      }
    });
    
    return {
      title: title || 'නොදනී',
      language: language || 'නොදනී',
      duration: duration || 'නොදනී',
      imdb: imdb || 'නොදනී',
      genres: genres.length ? genres : ['නොදනී'],
      directors: directors.length ? directors : ['නොදනී'],
      stars: stars.length ? stars : ['නොදනී'],
      thumbnail: thumbnail || ''
    };
  } catch (error) {
    console.error('Metadata error:', error.message);
    return {
      title: 'නොදනී',
      language: 'නොදනී',
      duration: 'නොදනී',
      imdb: 'නොදනී',
      genres: ['නොදනී'],
      directors: ['නොදනී'],
      stars: ['නොදනී'],
      thumbnail: ''
    };
  }
}

// ========== DOWNLOAD LINKS ==========
async function getDownloadLinks(movieUrl) {
  try {
    const response = await axios.get(movieUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
    
    const $ = cheerio.load(response.data);
    const links = [];
    
    // Pixeldrain සබැඳි සොයන්න
    $('a[href*="pixeldrain.com"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        let quality = 'HD';
        const parentText = $(el).closest('tr, div, li, td').text() || '';
        const qualityMatch = parentText.match(/(1080|720|480|HD|FHD|SD)/i);
        if (qualityMatch) quality = qualityMatch[1];
        
        links.push({
          link: href,
          quality: normalizeQuality(quality),
          size: 'නොදනී'
        });
      }
    });
    
    // Cinesubz download buttons
    if (links.length === 0) {
      $('.download-link, .download-btn, .btn-download, a[href*="download"]').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('http')) {
          let quality = 'HD';
          const text = $(el).text() || '';
          const qualityMatch = text.match(/(1080|720|480|HD|FHD|SD)/i);
          if (qualityMatch) quality = qualityMatch[1];
          
          links.push({
            link: href,
            quality: normalizeQuality(quality),
            size: 'නොදනී'
          });
        }
      });
    }
    
    return links;
  } catch (error) {
    console.error('Download links error:', error.message);
    return [];
  }
}

// ========== MAIN COMMAND ==========
cmd({
  pattern: "cs",
  alias: ["cinesubz", "films", "cinema"],
  react: "🎬",
  desc: "Cinesubz වෙතින් චිත්‍රපට සොයා බාගන්න",
  category: "download",
  filename: __filename
}, async (danuwa, mek, m, { from, q, sender, reply }) => {
  if (!q) {
    return reply(`*🎬 Cinesubz චිත්‍රපට සෙවුම*\n\n📌 භාවිතය:\n.movie චිත්‍රපට_නම\n\n📝 උදාහරණ:\n.movie harry potter\n.movie john wick\n.movie avatar`);
  }
  
  reply("*🔍 Cinesubz වෙතින් චිත්‍රපට සොයමින්...*\n⏳ කරුණාකර රැඳී සිටින්න");
  
  const searchResults = await searchMovies(q);
  
  if (!searchResults || searchResults.length === 0) {
    return reply(`*❌ චිත්‍රපට හමු නොවීය!*\n\n💡 උපදෙස්:\n• වෙනත් නමක් උත්සාහ කරන්න\n• .movie avengers\n• .movie කුමාරි\n\n🔗 සෘජුවම බලන්න:\nhttps://cinesubz.lk/?s=${encodeURIComponent(q)}`);
  }
  
  pendingSearch[sender] = { 
    results: searchResults, 
    timestamp: Date.now() 
  };
  
  let text = `*🎬 Cinesubz ප්‍රතිඵල:* (${searchResults.length}ක් හමුවිය)\n\n`;
  searchResults.forEach((m, i) => {
    text += `*${i+1}.* ${m.title}\n`;
    if (m.language) text += `   📝 භාෂාව: ${m.language}\n`;
    if (m.quality) text += `   📊 ගුණත්වය: ${m.quality}\n`;
    text += `\n`;
  });
  text += `*📌 චිත්‍රපටය තෝරා ගැනීමට අංකයක් යවන්න (1-${searchResults.length})*`;
  
  await danuwa.sendMessage(from, { text: text }, { quoted: mek });
});

// ========== SELECT MOVIE ==========
cmd({
  filter: (text, { sender }) => {
    return pendingSearch[sender] && 
           !isNaN(text) && 
           parseInt(text) > 0 && 
           parseInt(text) <= pendingSearch[sender].results.length;
  }
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const selected = pendingSearch[sender].results[index];
  delete pendingSearch[sender];
  
  reply(`*📖 චිත්‍රපට තොරතුරු ලබා ගනිමින්...*\n⏳ කරුණාකර රැඳී සිටින්න`);
  
  const metadata = await getMovieMetadata(selected.movieUrl);
  
  let msg = `*🎬 ${metadata.title}*\n\n`;
  msg += `*📝 භාෂාව:* ${metadata.language}\n`;
  msg += `*⏱️ කාලය:* ${metadata.duration}\n`;
  msg += `*⭐ IMDb:* ${metadata.imdb}\n`;
  msg += `*🎭 ප්‍රභේද:* ${metadata.genres.join(", ")}\n`;
  msg += `*🎥 අධ්‍යක්ෂවරු:* ${metadata.directors.join(", ")}\n`;
  msg += `*🌟 රංගන ශිල්පීන්:* ${metadata.stars.slice(0,5).join(", ")}${metadata.stars.length>5 ? "..." : ""}\n\n`;
  msg += `*🔗 බාගත කිරීමේ සබැඳි සොයමින්...*`;
  
  if (metadata.thumbnail) {
    await danuwa.sendMessage(from, { 
      image: { url: metadata.thumbnail }, 
      caption: msg 
    }, { quoted: mek });
  } else {
    await danuwa.sendMessage(from, { text: msg }, { quoted: mek });
  }
  
  const downloadLinks = await getDownloadLinks(selected.movieUrl);
  
  if (!downloadLinks || downloadLinks.length === 0) {
    return reply(`*❌ බාගත කිරීමේ සබැඳි හමු නොවීය!*\n\n💡 උපදෙස්:\n• සෘජුවම බාගන්න:\n${selected.movieUrl}\n\n• අතින් සොයන්න:\nhttps://cinesubz.lk/`);
  }
  
  pendingQuality[sender] = { 
    movie: { metadata, downloadLinks }, 
    timestamp: Date.now() 
  };
  
  let qualityMsg = `*📥 පවතින ගුණත්වයන්:*\n\n`;
  downloadLinks.forEach((d, i) => {
    qualityMsg += `*${i+1}.* ${d.quality} - ${d.size || 'ප්‍රමාණය නොදනී'}\n`;
  });
  qualityMsg += `\n*📌 ගුණත්ව අංකය යවන්න (1-${downloadLinks.length})*`;
  
  await danuwa.sendMessage(from, { text: qualityMsg }, { quoted: mek });
});

// ========== SEND MOVIE ==========
cmd({
  filter: (text, { sender }) => {
    return pendingQuality[sender] && 
           !isNaN(text) && 
           parseInt(text) > 0 && 
           parseInt(text) <= pendingQuality[sender].movie.downloadLinks.length;
  }
}, async (danuwa, mek, m, { body, sender, reply, from }) => {
  await danuwa.sendMessage(from, { react: { text: "✅", key: m.key } });
  
  const index = parseInt(body.trim()) - 1;
  const { movie } = pendingQuality[sender];
  delete pendingQuality[sender];
  
  const selectedLink = movie.downloadLinks[index];
  reply(`*⬇️ ${selectedLink.quality} චිත්‍රපටය යවමින්...*\n⏳ විශාල ගොනුවක් නම් ටික වේලාවක් ගතවිය හැක`);
  
  try {
    // Pixeldrain සබැඳියක් නම් direct ගන්න
    let directUrl = selectedLink.link;
    if (selectedLink.link.includes('pixeldrain.com')) {
      directUrl = getDirectPixeldrainUrl(selectedLink.link);
      if (!directUrl) {
        return reply(`*❌ සබැඳිය හැසිරවීමට නොහැකි විය!*\n\n🔗 ${selectedLink.link}`);
      }
    }
    
    const fileName = `${movie.metadata.title || 'Movie'} - ${selectedLink.quality}.mp4`
      .replace(/[^\w\s.-]/gi, '')
      .substring(0, 50);
    
    await danuwa.sendMessage(from, {
      document: { url: directUrl },
      mimetype: "video/mp4",
      fileName: fileName,
      caption: `*🎬 ${movie.metadata.title || 'Movie'}*\n*📊 ගුණත්වය:* ${selectedLink.quality}\n*💾 ප්‍රමාණය:* ${selectedLink.size || 'නොදනී'}\n\n*🍿 සතුටින් නරඹන්න!*`
    }, { quoted: mek });
    
  } catch (error) {
    console.error('Send error:', error);
    reply(`*❌ චිත්‍රපටය යැවීමට අසමත් විය!*\n\nදෝෂය: ${error.message || 'නොදන්නා දෝෂයකි'}\n\n🔗 සෘජුව බාගන්න:\n${selectedLink.link}`);
  }
});

// ========== CLEANUP ==========
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000; // විනාඩි 10
  
  for (const s in pendingSearch) {
    if (now - pendingSearch[s].timestamp > timeout) {
      delete pendingSearch[s];
    }
  }
  for (const s in pendingQuality) {
    if (now - pendingQuality[s].timestamp > timeout) {
      delete pendingQuality[s];
    }
  }
}, 5 * 60 * 1000);

module.exports = { pendingSearch, pendingQuality };
