const { cmd } = require("../command");
const { searchCineSubz, scrapeCineSubz, scrapeCineSubzServerLink } = require('cinesubz-scraper');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

// ============ SESSION STORAGE ============
const pendingSearch = {};

// ============ IMPROVED LINK EXTRACTOR ============
async function extractDirectLink(linkUrl) {
    try {
        console.log(`🔍 Extracting link from: ${linkUrl}`);
        
        // Method 1: Try with cinesubz-scraper
        try {
            const directLink = await scrapeCineSubzServerLink(linkUrl);
            if (directLink && directLink.startsWith('http') && !directLink.includes('undefined')) {
                console.log(`✅ Found via scraper: ${directLink}`);
                return directLink;
            }
        } catch (e) {
            console.log('⚠️ Scraper failed, trying other methods...');
        }

        // Method 2: Try with axios + cheerio
        try {
            const response = await axios.get(linkUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            
            // Find download links
            const links = [];
            
            // Check all links
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().toLowerCase();
                if (href && href.startsWith('http')) {
                    if (text.includes('download') || 
                        text.includes('direct') ||
                        text.includes('server') ||
                        href.includes('download') ||
                        href.includes('pixeldrain') ||
                        href.includes('drive.google') ||
                        href.includes('mega.nz') ||
                        href.includes('mediafire') ||
                        href.includes('terabox') ||
                        href.includes('.mp4') ||
                        href.includes('.mkv')) {
                        links.push(href);
                    }
                }
            });

            // Check specific selectors
            $('.download-btn a, .btn-download a, .direct-download a, .download-link a, .server-link a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.startsWith('http')) {
                    links.push(href);
                }
            });

            if (links.length > 0) {
                console.log(`✅ Found via axios: ${links[0]}`);
                return links[0];
            }
        } catch (e) {
            console.log('⚠️ Axios failed:', e.message);
        }

        // Method 3: Try with puppeteer (if available)
        try {
            const puppeteer = require('puppeteer');
            const browser = await puppeteer.launch({ 
                headless: true, 
                args: ['--no-sandbox', '--disable-setuid-sandbox'] 
            });
            const page = await browser.newPage();
            await page.goto(linkUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // Wait for download button
            await page.waitForSelector('.download-btn a, .btn-download a, .direct-download a', { timeout: 10000 }).catch(() => {});

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
                console.log(`✅ Found via puppeteer: ${links[0]}`);
                return links[0];
            }
        } catch (e) {
            console.log('⚠️ Puppeteer failed:', e.message);
        }

        // Method 4: Return original URL as fallback
        console.log('⚠️ No direct link found, using original');
        return linkUrl;

    } catch (error) {
        console.error('❌ Error extracting link:', error);
        return linkUrl;
    }
}

// ============ DOWNLOAD AND SEND FILE ============
async function downloadAndSendFile(client, from, downloadUrl, fileName, caption, m) {
    try {
        // Create temp directory
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, fileName);
        
        console.log(`📥 Downloading: ${fileName}`);
        console.log(`📥 From: ${downloadUrl}`);

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading Movie File*\n━━━━━━━━━━━━━━━━\n⏳ Please wait... This may take a few minutes.`
        }, { quoted: m });

        // Download the file
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream',
            timeout: 600000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });

        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', async () => {
                try {
                    const stats = fs.statSync(filePath);
                    const fileSizeMB = stats.size / (1024 * 1024);
                    
                    console.log(`✅ Download complete: ${fileSizeMB.toFixed(2)} MB`);

                    if (fileSizeMB > 2000) {
                        fs.unlinkSync(filePath);
                        resolve({ 
                            success: false, 
                            message: `File too large (${fileSizeMB.toFixed(2)} MB). WhatsApp limit is 2GB.` 
                        });
                        return;
                    }

                    await client.sendMessage(from, {
                        document: {
                            url: filePath
                        },
                        mimetype: "video/mp4",
                        fileName: fileName,
                        caption: caption
                    }, { quoted: m });

                    fs.unlinkSync(filePath);
                    
                    resolve({ 
                        success: true, 
                        message: "File sent successfully!",
                        size: fileSizeMB.toFixed(2)
                    });

                } catch (error) {
                    try { fs.unlinkSync(filePath); } catch (e) {}
                    reject(error);
                }
            });

            writer.on('error', (error) => {
                try { fs.unlinkSync(filePath); } catch (e) {}
                reject(error);
            });
        });

    } catch (error) {
        console.error("Download error:", error);
        return { 
            success: false, 
            message: error.message || "Download failed" 
        };
    }
}

// ============ DOWNLOAD MOVIE FILE FUNCTION ============
async function downloadMovieFile(client, from, movie, quality, m, reply) {
    try {
        // Get movie details
        const details = await scrapeCineSubz(movie.url || movie.movieUrl);
        
        if (!details.downloadLinks || details.downloadLinks.length === 0) {
            return reply(`❌ *No download links found for this movie*`);
        }

        // Log all available links for debugging
        console.log(`📊 Available links for ${details.title}:`);
        details.downloadLinks.forEach((link, i) => {
            console.log(`  ${i+1}. ${link.quality} - ${link.size}`);
            console.log(`     URL: ${link.url || link.link || 'N/A'}`);
        });

        // Find quality
        let selectedLink = null;
        for (const link of details.downloadLinks) {
            if (link.quality && link.quality.toLowerCase().includes(quality.toLowerCase())) {
                selectedLink = link;
                break;
            }
        }

        if (!selectedLink) {
            const priority = ['1080p', '720p', '480p'];
            for (const q of priority) {
                for (const link of details.downloadLinks) {
                    if (link.quality && link.quality.toLowerCase().includes(q)) {
                        selectedLink = link;
                        break;
                    }
                }
                if (selectedLink) break;
            }
        }

        if (!selectedLink) {
            selectedLink = details.downloadLinks[0];
        }

        // Get download URL with multiple fallbacks
        let downloadUrl = null;
        
        // Try different properties
        if (selectedLink.directUrl) downloadUrl = selectedLink.directUrl;
        else if (selectedLink.url) downloadUrl = selectedLink.url;
        else if (selectedLink.link) downloadUrl = selectedLink.link;
        else if (selectedLink.href) downloadUrl = selectedLink.href;
        else if (selectedLink.downloadLink) downloadUrl = selectedLink.downloadLink;

        console.log(`📥 Selected link: ${downloadUrl}`);

        if (!downloadUrl || downloadUrl === 'undefined' || downloadUrl === 'null') {
            return reply(`❌ *Could not get download URL*\n\nTry another quality or movie.`);
        }

        // Extract direct link
        let directUrl = await extractDirectLink(downloadUrl);
        
        if (!directUrl || directUrl === 'undefined' || directUrl === 'null') {
            directUrl = downloadUrl;
        }

        console.log(`✅ Final URL: ${directUrl}`);

        // Prepare file name
        const cleanTitle = details.title || movie.title || 'Movie';
        const cleanQuality = selectedLink.quality || quality;
        const fileName = `${cleanTitle} - ${cleanQuality}.mp4`.replace(/[^\w\s.-]/gi, '');

        // Send progress message
        await client.sendMessage(from, {
            text: `📥 *Downloading*\n━━━━━━━━━━━━━━━━\n🎬 ${cleanTitle}\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'Unknown'}\n\n⏳ Please wait... This may take a few minutes.`
        }, { quoted: m });

        // Download and send
        const result = await downloadAndSendFile(
            client,
            from,
            directUrl,
            fileName,
            `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'N/A'}\n\n*Powered by Zanta Bot*`,
            m
        );

        if (!result.success) {
            // Try with original URL if direct failed
            if (directUrl !== downloadUrl) {
                console.log(`🔄 Retrying with original URL: ${downloadUrl}`);
                const retryResult = await downloadAndSendFile(
                    client,
                    from,
                    downloadUrl,
                    fileName,
                    `🎬 *${cleanTitle}*\n📊 ${cleanQuality}\n💾 ${selectedLink.size || 'N/A'}\n\n*Powered by Zanta Bot*`,
                    m
                );
                
                if (!retryResult.success) {
                    reply(`❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${retryResult.message}`);
                }
            } else {
                reply(`❌ *Download Failed*\n━━━━━━━━━━━━━━━━\n${result.message}`);
            }
        }

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
}

// ============ MAIN COMMAND ============
cmd({
    pattern: "cs",
    alias: ["cinesubz", "movie", "film"],
    react: "🎬",
    desc: "CineSubz එකෙන් චිත්‍රපට File එක බාගන්න",
    category: "download",
    filename: __filename
}, async (client, message, m, { from, q, sender, reply }) => {
    if (!q) {
        return reply(`🎬 *CineSubz Movie Downloader*

*භාවිතය:*
• cs චිත්‍රපට_නම
• movie චිත්‍රපට_නම

*උදාහරණ:*
• cs harry potter
• movie avatar
• cs captain america 720p

*Quality එකත් දාන්න පුළුවන්:*
• cs harry potter 1080p
• cs avatar 720p`);
    }

    await client.sendMessage(from, { 
        react: { text: "⏳", key: m.key } 
    });

    // Parse quality
    const parts = q.trim().split(/\s+/);
    let movieName = q;
    let quality = '720p';

    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.match(/^\d{3,4}p$/)) {
        movieName = parts.slice(0, -1).join(' ');
        quality = lastPart;
    }

    reply(`🔍 *Searching for "${movieName}"...*`);

    try {
        const results = await searchCineSubz(movieName);
        
        if (!results || results.length === 0) {
            return reply(`❌ *No movies found for "${movieName}"*`);
        }

        if (results.length > 1) {
            pendingSearch[sender] = { 
                results: results, 
                quality: quality,
                timestamp: Date.now() 
            };

            let msg = `🎬 *Search Results*\n━━━━━━━━━━━━━━━━\n\n`;
            const displayCount = Math.min(8, results.length);
            
            for (let i = 0; i < displayCount; i++) {
                const movie = results[i];
                msg += `*${i+1}.* ${movie.title || 'N/A'}\n`;
                msg += `   📊 ${movie.quality || 'N/A'}\n`;
                msg += `   📝 ${movie.language || 'N/A'}\n\n`;
            }
            
            msg += `━━━━━━━━━━━━━━━━\n`;
            msg += `📌 *Reply with number (1-${displayCount})*\n`;
            msg += `⏱️ *Expires in 5 minutes*`;

            await client.sendMessage(from, { text: msg }, { quoted: m });
            return;
        }

        const movie = results[0];
        await downloadMovieFile(client, from, movie, quality, m, reply);

    } catch (error) {
        console.error("Download error:", error);
        reply(`❌ *Error:* ${error.message || 'Unknown error'}`);
    }
});

// ============ HANDLE SEARCH SELECTION ============
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
    const { results, quality } = pendingSearch[sender];
    const selected = results[index];

    await downloadMovieFile(client, from, selected, quality, m, reply);
    
    delete pendingSearch[sender];
});

// ============ AUTO CLEANUP ============
setInterval(() => {
    const now = Date.now();
    const timeout = 5 * 60 * 1000;
    
    for (const sender in pendingSearch) {
        if (now - pendingSearch[sender].timestamp > timeout) {
            delete pendingSearch[sender];
        }
    }

    try {
        const tempDir = path.join(__dirname, 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                const age = (now - stats.mtimeMs) / (1000 * 60);
                if (age > 30) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted old temp file: ${file}`);
                }
            }
        }
    } catch (e) {}
}, 5 * 60 * 1000);

// ============ EXPORT ============
module.exports = { 
    pendingSearch
};
