const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const cheerio = require('cheerio');

// Session storage
const pendingSearch = {};
const pendingDownload = {};

// ============ IMPROVED DIRECT LINK EXTRACTOR ============
async function extractDirectLink(pageUrl) {
    try {
        console.log(`🔍 Extracting link from: ${pageUrl}`);
        
        // Method 1: Try with scrapeCineSubzServerLink
        try {
            const directLink = await scrapeCineSubzServerLink(pageUrl);
            if (directLink && directLink.startsWith('http')) {
                console.log(`✅ Found via scrapeCineSubzServerLink: ${directLink}`);
                return directLink;
            }
        } catch (e) {
            console.log('⚠️ scrapeCineSubzServerLink failed, trying other methods...');
        }

        // Method 2: Try with Axios + Cheerio
        try {
            const response = await axios.get(pageUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            
            // Common patterns for download links
            const patterns = [
                // Pixeldrain
                'a[href*="pixeldrain.com"]',
                'a[href*="drive.google.com"]',
                'a[href*="mega.nz"]',
                'a[href*="terabox.com"]',
                'a[href*="mediafire.com"]',
                'a[href*="dropbox.com"]',
                // Download buttons
                '.download-btn a',
                '.btn-download a',
                '.direct-download a',
                '.download-link a',
                'a.download',
                'a[download]',
                // Video links
                'video source',
                'a[href$=".mp4"]',
                'a[href$=".mkv"]',
                'a[href$=".avi"]'
            ];

            for (const pattern of patterns) {
                const links = $(pattern);
                for (let i = 0; i < links.length; i++) {
                    const href = $(links[i]).attr('href');
                    if (href && href.startsWith('http')) {
                        console.log(`✅ Found link via pattern ${pattern}: ${href}`);
                        return href;
                    }
                }
            }

            // Method 3: Look for any link containing download keywords
            $('a').each((i, element) => {
                const href = $(element).attr('href');
                const text = $(element).text().toLowerCase();
                if (href && href.startsWith('http')) {
                    if (text.includes('download') || 
                        text.includes('direct') || 
                        text.includes('server') ||
                        href.includes('download') ||
                        href.includes('file')) {
                        console.log(`✅ Found via keyword search: ${href}`);
                        return href;
                    }
                }
            });

        } catch (e) {
            console.log('⚠️ Axios method failed:', e.message);
        }

        // Method 4: Try with Puppeteer (if available)
        try {
            const puppeteer = require('puppeteer');
            const browser = await puppeteer.launch({ 
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            const links = await page.evaluate(() => {
                const results = [];
                
                // Check all links
                document.querySelectorAll('a').forEach(link => {
                    const href = link.href;
                    const text = link.textContent.toLowerCase();
                    if (href && href.startsWith('http')) {
                        if (text.includes('download') || 
                            text.includes('direct') ||
                            href.includes('download') ||
                            href.includes('pixeldrain') ||
                            href.includes('drive.google') ||
                            href.includes('mega.nz') ||
                            href.includes('terabox') ||
                            href.includes('.mp4') ||
                            href.includes('.mkv')) {
                            results.push(href);
                        }
                    }
                });

                // Check video sources
                document.querySelectorAll('video source').forEach(source => {
                    if (source.src && source.src.startsWith('http')) {
                        results.push(source.src);
                    }
                });

                return results;
            });

            await browser.close();

            if (links && links.length > 0) {
                console.log(`✅ Found via Puppeteer: ${links[0]}`);
                return links[0];
            }

        } catch (e) {
            console.log('⚠️ Puppeteer method failed:', e.message);
        }

        // Method 5: If all methods fail, return the original URL
        console.log('⚠️ No direct link found, returning original URL');
        return pageUrl;

    } catch (error) {
        console.error('❌ Error extracting link:', error);
        return null;
    }
}

// ============ MAIN SEARCH COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "Search and download movies from CineSubz",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Movie Downloader*

*Usage:*
• cs movie_name
• cinesubz movie_name
• movie movie_name

*Examples:*
• cs captain america
• cinesubz inception
• movie avatar`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    reply("*🔍 Searching for movies on CineSubz...*");

    try {
        const results = await searchCineSubz(q);
        
        if (!results || results.length === 0) {
            return reply("❌ *No movies found!*\n\nTry with different keywords.");
        }

        pendingSearch[sender] = { 
            results: results, 
            timestamp: Date.now() 
        };

        let msg = "*🎬 Search Results:*\n\n";
        const displayCount = Math.min(10, results.length);
        
        for (let i = 0; i < displayCount; i++) {
            const movie = results[i];
            msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
            msg += `   📊 Quality: ${movie.quality || 'N/A'}\n`;
            msg += `   📝 Language: ${movie.language || 'N/A'}\n`;
            msg += `   📅 Year: ${movie.year || 'N/A'}\n\n`;
        }
        
        msg += `*📌 Type a number (1-${displayCount})*\n`;
        msg += `⏱️ *Session expires in 10 minutes*`;

        await client.sendMessage(from, { text: msg }, { quoted: m });

    } catch (error) {
        console.error("Search error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE MOVIE SELECTION ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingSearch[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingSearch[sender].results.length;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "✅", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const selected = pendingSearch[sender].results[index];
    
    reply(`*📥 Fetching movie details...*\n${selected.title}`);

    try {
        const details = await scrapeCineSubz(selected.url || selected.movieUrl);
        
        let caption = `*🎬 ${details.title || selected.title}*\n\n`;
        caption += `*📅 Year:* ${details.year || 'N/A'}\n`;
        caption += `*📝 Language:* ${details.language || 'N/A'}\n`;
        caption += `*⭐ IMDb:* ${details.imdb || details.rating || 'N/A'}\n`;
        
        if (details.genres && details.genres.length > 0) {
            caption += `*🎭 Genres:* ${details.genres.join(', ')}\n`;
        }
        
        if (details.cast && details.cast.length > 0) {
            caption += `*👥 Cast:* ${details.cast.slice(0, 5).join(', ')}${details.cast.length > 5 ? '...' : ''}\n`;
        }
        
        caption += `\n*📖 Description:*\n${details.description ? details.description.substring(0, 300) + '...' : 'N/A'}\n\n`;

        if (details.downloadLinks && details.downloadLinks.length > 0) {
            pendingDownload[sender] = {
                movie: details,
                links: details.downloadLinks,
                timestamp: Date.now()
            };

            caption += `*📥 Download Links:*\n`;
            details.downloadLinks.forEach((link, i) => {
                caption += `*${i+1}.* ${link.quality || 'N/A'} - ${link.size || 'N/A'}\n`;
                caption += `   🔗 Server: ${link.server || 'Direct'}\n`;
            });
            caption += `\n*📌 Type a number to get the download link*`;
        } else {
            caption += `*❌ No download links available for this movie*`;
        }

        if (details.thumbnail || details.poster) {
            const imageUrl = details.thumbnail || details.poster;
            await client.sendMessage(from, {
                image: { url: imageUrl },
                caption: caption
            }, { quoted: m });
        } else {
            await client.sendMessage(from, { text: caption }, { quoted: m });
        }

        delete pendingSearch[sender];

    } catch (error) {
        console.error("Details error:", error);
        reply(`❌ *Error fetching details:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE DOWNLOAD SELECTION (IMPROVED) ============
cmd({
    filter: (text, { sender }) => {
        if (!pendingDownload[sender]) return false;
        const num = parseInt(text.trim());
        return !isNaN(num) && num > 0 && num <= pendingDownload[sender].links.length;
    }
}, async (client, message, m, { body, sender, reply, from }) => {
    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    const index = parseInt(body.trim()) - 1;
    const { movie, links } = pendingDownload[sender];
    const selectedLink = links[index];

    reply(`*🔗 Getting ${selectedLink.quality || 'HD'} download link...*\nPlease wait.`);

    try {
        // Get the URL from the selected link
        let downloadUrl = selectedLink.url || selectedLink.link || selectedLink.href;
        
        console.log(`📥 Original URL: ${downloadUrl}`);

        // If URL is undefined or empty, try to find it from the link object
        if (!downloadUrl || downloadUrl === 'undefined') {
            console.log('⚠️ URL is undefined, trying to find alternative...');
            
            // Try to get from the link object properties
            for (const key of ['url', 'link', 'href', 'directUrl', 'downloadUrl']) {
                if (selectedLink[key] && selectedLink[key] !== 'undefined') {
                    downloadUrl = selectedLink[key];
                    console.log(`✅ Found URL in property ${key}: ${downloadUrl}`);
                    break;
                }
            }
            
            // If still no URL, use the movie URL to extract
            if (!downloadUrl || downloadUrl === 'undefined') {
                console.log('⚠️ Still no URL, using movie URL...');
                downloadUrl = movie.url || movie.movieUrl;
            }
        }

        // If URL is a server link, extract the direct link
        let directLink = null;
        if (downloadUrl && downloadUrl.startsWith('http')) {
            console.log(`🔍 Extracting direct link from: ${downloadUrl}`);
            directLink = await extractDirectLink(downloadUrl);
        }

        // Use extracted link or fallback to original
        const finalUrl = directLink || downloadUrl;

        // Send the download link
        let messageText = `*🎬 ${movie.title || 'Movie'}*\n\n`;
        messageText += `*📊 Quality:* ${selectedLink.quality || 'N/A'}\n`;
        messageText += `*💾 Size:* ${selectedLink.size || 'N/A'}\n`;
        messageText += `*🔗 Server:* ${selectedLink.server || 'Direct'}\n\n`;
        messageText += `*📥 Download Link:*\n${finalUrl || 'No link found'}\n\n`;
        
        if (finalUrl && finalUrl !== 'undefined') {
            messageText += `*ℹ️ Instructions:*\n`;
            messageText += `1. Copy the link and open in browser\n`;
            messageText += `2. Click download button\n`;
            messageText += `3. If using mobile, use a download manager\n\n`;
        } else {
            messageText += `*❌ Could not extract download link*\n`;
            messageText += `*Possible reasons:*\n`;
            messageText += `• Link requires captcha verification\n`;
            messageText += `• Content is protected\n`;
            messageText += `• Server is temporarily down\n\n`;
            messageText += `*Try these steps:*\n`;
            messageText += `1. Open the movie page manually\n`;
            messageText += `2. Look for download buttons\n`;
            messageText += `3. Try different quality option\n`;
            messageText += `4. Use the link in the movie details above`;
        }

        await client.sendMessage(from, { text: messageText }, { quoted: m });

        // Try to send file if direct link found
        if (finalUrl && finalUrl !== 'undefined' && 
            (finalUrl.includes('.mp4') || 
             finalUrl.includes('.mkv') || 
             finalUrl.includes('pixeldrain.com/api/file') ||
             finalUrl.includes('drive.google.com/uc'))) {
            
            try {
                await client.sendMessage(from, {
                    document: { url: finalUrl },
                    mimetype: "video/mp4",
                    fileName: `${movie.title || 'movie'} - ${selectedLink.quality || 'HD'}.mp4`.replace(/[^\w\s.-]/gi, ''),
                    caption: `*🎬 ${movie.title || 'Movie'}*\n*📊 ${selectedLink.quality || 'HD'}*\n\n*Enjoy the movie! 🍿*`
                }, { quoted: m });
            } catch (uploadError) {
                console.error("Upload error:", uploadError);
                // Link already sent above
            }
        }

        delete pendingDownload[sender];

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error getting download link:* ${error.message || 'Unknown error'}\n\n*Try these steps:*\n1. Try a different quality\n2. Open the movie page manually\n3. Try again later`);
    }
});

// ============ AUTO CLEANUP SESSIONS ============
setInterval(() => {
    const now = Date.now();
    const timeout = 10 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }
    
    for (const sender in pendingDownload) {
        if (now - pendingDownload[sender].timestamp > timeout) {
            delete pendingDownload[sender];
        }
    }
}, 5 * 60 * 1000);

// ============ EXPORT ============
module.exports = { 
    pendingSearch, 
    pendingDownload 
};
